/*
*
* Routes
*
* */

// Module dependencies
var config = require('../config.js'),
    crypto = require('crypto'),
    net = require('net'),
    async = require('async'),
    User = require('../models/user.js'),
    Admin = require('../models/admin.js'),
    Domain = require('../models/domain.js'),
    Record = require('../models/record.js'),
    check = require('validator').check,
    sanitize = require('validator').sanitize,
    tld = require('tldjs'),
    nodemailer = require("nodemailer");
    // dns = require('dns');

// create reusable transport method (opens pool of SMTP connections)
var smtpTransport = nodemailer.createTransport("SMTP", {
    service: config.serviceMailSMTP,
    // host: "smtp.moedns.com", // hostname
    //secureConnection: true, // use SSL
    // port: 465, // port for secure SMTP
    auth: {
        user: config.serviceMailUser,
        pass: config.serviceMailPass
    }
});

// function to test a object is empty.
// Via http://stackoverflow.com/questions/4994201/is-object-empty
var hasOwnProperty = Object.prototype.hasOwnProperty;
Object.prototype.isEmpty = function(obj) {
    // null and undefined are empty
    if (obj == null) return true;
    // Assume if it has a length property with a non-zero value
    // that that property is correct.
    if (obj.length && obj.length > 0)    return false;
    if (obj.length === 0)  return true;

    for (var key in obj) {
        if (hasOwnProperty.call(obj, key))    return false;
    }

    return true;
}


// Route functions
module.exports = function(app) {

    app.get('/', function(req, res) {
        res.render('index', {
            siteName: config.siteName,
            siteTagline: config.siteTagline,
            title: res.__('HOME') + ' - ' + config.siteName,
            allowReg: config.allowReg,
            user: req.session.user,
            success: req.flash('success').toString(),
            error: req.flash('error').toString()
        });
    });

    /* User routes */
    // Registration
    app.get('/reg', checkNotLogin, function(req, res) {
        if (!config.allowReg) {
            res.redirect('/');
            return req.flash(res.__("REG_NOT_ALLOWED"));
        }
        res.render('reg',{
            title: res.__('REGISTER') + ' - ' + config.siteName,
            siteName: config.siteName,
            siteTagline: config.siteTagline,
            allowReg: config.allowReg,
            user: req.session.user,
            allowReg: config.allowReg,
            success: req.flash('success').toString(),
            error: req.flash('error').toString()
        });
    });

    app.post('/reg', checkNotLogin, function(req,res){
        if (!config.allowReg) {
            res.redirect('/');
            return req.flash(res.__("REG_NOT_ALLOWED"));
        }
        var name = req.body.username,
            mail = req.body.email,
            password = req.body.password,
            repeatPassword = req.body['password-repeat'];

        try {
            check(name, 'USERNAME_EMPTY').notEmpty();
            check(name, 'USERNAME_ALPHANUMERIC').isAlphanumeric();
            check(password, 'PASSWORD_EMPTY').notEmpty();
            check(repeatPassword, 'PASSWORD_NOT_EQUAL').equals(password);
            check(mail, 'EMAIL_INVALID').len(4, 64).isEmail();
        } catch (e) {
            req.flash('error', res.__(e.message));
            return res.redirect('/reg');
        }

        // get password hash
        var hash = crypto.createHash('sha256'),
            password = hash.update(req.body.password).digest('hex');
        var newUser = new User({
            name: name,
            password: password,
            email: mail
        });
        // check if username exists.
        User.check(newUser.name, newUser.email, function(err, user){
            // console.log(user);
            if(user) {
                err = 'USER_EXISTS';
            }
            if(err) {
                req.flash('error', res.__(err));
                return res.redirect('/reg');
            }
            newUser.save(function(err){
                if(err){
                    req.flash('error',err);
                    return res.redirect('/reg');
                }
                req.session.user = newUser; // store user information to session.
                req.flash('success',res.__('REG_SUCCESS'));
                res.redirect('/');
            });
        });
    });

    // Login/logout
    app.get('/login', checkNotLogin, function(req,res){
        res.render('login',{
            title: res.__('LOGIN') + ' - ' + config.siteName,
            siteName: config.siteName,
            siteTagline: config.siteTagline,
            allowReg: config.allowReg,
            user: req.session.user,
            success: req.flash('success').toString(),
            error: req.flash('error').toString()
        });
    });
    // TODO password recovery.
    app.post('/login', checkNotLogin, function(req, res){
        // Generate password hash
        var hash = crypto.createHash('sha256'),
            password = hash.update(req.body.password).digest('hex');
        // check login details
        User.get(req.body.username, function(err, user) {
            if(!user || user.password != password) {
                req.flash('error', res.__('LOGIN_FAIL'));
                return res.redirect('/login');
            }
            // Login success, store user information to session.
            req.session.user = user;
            req.flash('success', res.__('LOGIN_SUCCESS'));
            res.redirect('/');
        });
    });

    app.post('/logout', checkLogin, function(req, res) {
        req.session.user = null;
        req.flash('success',res.__('LOGOUT_SUCCESS'));
        res.redirect('/');
    });

    app.get('/account', checkLogin, function(req, res) {
        res.render('account',{
            title: res.__('MY_ACCOUNT') + ' - ' + config.siteName,
            siteName: config.siteName,
            siteTagline: config.siteTagline,
            allowReg: config.allowReg,
            user: req.session.user,
            success: req.flash('success').toString(),
            error: req.flash('error').toString()
        });
    });

    app.post('/account', checkLogin, function(req, res) {
        var email = req.body.email,
            hash = crypto.createHash('sha256'),
            password = hash.update(req.body.password).digest('hex'),
            newPassword = req.body.newpass,
            repeatPassword = req.body['password-repeat'],
            inputError = '';

        if (password != req.session.user.password) {
            inputError = 'WRONG_PASSWORD';
        }
        if (repeatPassword || newPassword) {
            var hash = crypto.createHash('sha256'),
                newPassword = hash.update(newPassword).digest('hex');
            var hash = crypto.createHash('sha256'),
                repeatPassword = hash.update(repeatPassword).digest('hex');
            if (repeatPassword != newPassword) {
                inputError = 'PASSWORD_NOT_EQUAL';
            }
            password = newPassword;
        }

        try {
            check(email, 'EMAIL_INVALID').len(4, 64).isEmail();
        } catch (e) {
            inputError = e.message;
        }

        if (inputError) {
            req.flash('error', res.__(inputError));
            return res.redirect('/account');
        }

        var newUser = new User({
            name: req.session.user.name,
            email: email,
            password: password
        });

        User.edit(newUser, function(err, user){
            if(err) {
                req.flash('error', res.__(err));
                return res.redirect('/me');
            }
            req.flash('success', res.__('USER_UPDATED'));
            req.session.user = null;
            res.redirect('/login');
        });
    });


    /* Domain routes */
    // List domains under a user
    app.get('/domains', checkLogin, function(req, res) {
       Domain.getList(req.session.user.name, function(err, domains) {
           if(err){
               req.flash('error',err);
               return res.redirect('/domains');
           }
           res.render('domains', {
               title: res.__('MY_DOMAINS') + ' - ' + config.siteName,
               siteName: config.siteName,
               siteTagline: config.siteTagline,
               allowReg: config.allowReg,
               user: req.session.user,
               domains: domains,
               powerservers: config.powerservers,
               success: req.flash('success').toString(),
               error: req.flash('error').toString()
           });
       })
    });

    // Add domain
    app.post('/add-domain', checkLogin, function(req, res) {
        // Validate whether user input is root domain name.
        var newDomain = new Domain({
            name: req.body.domain,
            belongs: req.session.user.name
        });
        if (tld.getDomain(newDomain.name) == newDomain.name && tld.tldExists(newDomain.name)) {
            // Domain valid, check if domain exists in db.
            Domain.check(newDomain.name, function(err, data) {
                if (data) {
                    console.log(data);
                    // Domain exists, return error.

                    req.flash('error', res.__('DOMAIN_EXISTS'));
                    return res.redirect('/domains');
                } else {
                    // Domain not exist, insert into database.
                    newDomain.save(function(err) {
                        if (err) {
                            res.redirect('/domains');
                            return req.flash('error',err);
                        }
                        req.flash('success',res.__('ADD_DOMAIN_SUCCESS'));
                        res.redirect('/domains');
                    });
                }
            });
        } else {
            req.flash('error', res.__('DOMAIN_NOT_VALID'));
            return res.redirect('/domains');
        }
    });

    // Remove a domain
    app.post('/domain/:domain/delete', checkLogin, function(req, res) {
        var domain = req.params.domain,
            id = parseInt(req.body.domainId),
            user = req.session.user;
        // console.log(id);
        // console.log(domain);
        // console.log(user.name);
        Domain.checkOwner(domain, user.name, function(err, doc) {
            // console.log(doc);
            if (err) {
                req.flash('error', err);
                return res.redirect('/domains');
            }
            if (doc == null) {
                req.flash('error', res.__('DOMAIN_NOT_OWNED'));
                return res.redirect('/domains');
            } else {
                Domain.remove(id, user.name, function(err) {
                    if (err) {
                        req.flash('error', err);
                        return res.redirect('/domains');
                    }
                    req.flash('success', res.__('DOMAIN_DELETED'));
                    res.redirect('/domains');
                });
            }
        });

    });

    app.get('/domain/:domain', checkLogin, function(req, res) {
       var domain = req.params.domain,
           user = req.session.user;
       Domain.checkOwner(domain, user.name, function(err, doc) {
            if (err) {
                req.flash('error', err);
                return res.redirect('/domains');
            }
            if (doc == null) {
                req.flash('error', res.__('DOMAIN_NOT_OWNED'));
                return res.redirect('/domains');
            } else {
                // Get domain records
                // console.log(doc);
                Record.getList(doc.id, function(err, records) {
                    if (err) {
                        req.flash('error', err);
                        return res.redirect('/domains');
                    }
                    // console.log(records);
                    res.render('records', {
                        title: res.__('DOMAIN') + ': ' + domain.toUpperCase() + ' - ' + config.siteName,
                        siteName: config.siteName,
                        siteTagline: config.siteTagline,
                        allowReg: config.allowReg,
                        user: req.session.user,
                        domain: doc,
                        powerservers: config.powerservers,
                        records: records,
                        success: req.flash('success').toString(),
                        error: req.flash('error').toString()
                    });
                });
            }
       });

    });


    /*
    * Record routes
    * */
    // Add a record.
    app.post('/domain/:domain/add-record', checkLogin, function(req, res) {
        // console.log(req.body);
        var type = req.body.type,
            name = req.body.name == '@'?req.params.domain:req.body.name + '.' + req.params.domain,
            ttl = req.body.ttl,
            prio = req.body.prio || null,
            content = req.body.content;

        try {
            check(ttl, 'TTL_ERROR').isDecimal().min(60);
            switch (type) {
                case "A":
                    check(content, 'NEED_IPV4').isIPv4();
                    prio = null;
                    break;
                case "AAAA":
                    check(content, 'NEED_IPV6').isIPv6();
                    prio = null;
                    break;
                case ("CNAME"):
                    if (tld.isValid(content) && tld.tldExists(content)) {
                        prio = null;
                    } else {
                        throw new Error("VALUE_ERROR");
                    }
                    break;
                case "NS":
                    if (tld.isValid(content) && tld.tldExists(content)) {
                        prio = null;
                    } else {
                        throw new Error("VALUE_ERROR");
                    }
                    break;
                case "MX":
                    if (tld.isValid(content) && tld.tldExists(content)) {
                        //  Better DNS check module needed.
                        //    dns.resolve(content, function(err, addresses) {
                        //        console.log(addresses);
                        //        if (addresses === undefined) {
                        //            throw new Error("NEED_A_RECORD");
                        //        } else {
                        //
                        //        }
                        //    });
                        //
                    } else {
                        throw new Error("VALUE_ERROR");
                    }
                    check(prio, 'PRIO_ERROR').isDecimal().max(100).min(1);
                    break;
                case "SRV":
                    // _service._proto.name. TTL class SRV priority weight port target.
                    name = "_" + req.body.service + "._" + req.body.protocol + "." + req.params.domain;
                    content = req.body.weight + " " + req.body.port + " " + req.body.content;
                    break;
                case "TXT":
                    prio = null;
                    break;
                default:
                    throw new Error("TYPE_ERROR");
            }
        } catch (e) {
            console.log(e);
            req.flash('error', res.__(e.message));
            return res.redirect('/domain/' + req.params.domain);
        }



        // TODO Check user inputs for record validity
        // Better RegEx required.
/*        try {
            check(type, 'TYPE_ERROR').isIn([
                "A",
                "AAAA",
                "CNAME",
                "NS",
                "MX",
                "SRV",
                "TXT"
            ]);
            check(ttl, 'TTL_ERROR').isDecimal().min(60);
            switch (type) {
                case "A":
                    check(content, 'NEED_IPV4').isIPv4();
                    prio = null;
                    break;
                case "AAAA":
                    check(content, 'NEED_IPV6').isIPv6();
                    prio = null;
                    break;
                case ("CNAME" || "NS"):
                    if (tld.isValid(content) && tld.tldExists(content)) {
                        prio = null;
                    } else {
                        throw new Error("VALUE_ERROR");
                    }
                    break;
                case "MX":
                    if (tld.isValid(content) && tld.tldExists(content)) {
                    //  Better DNS check module needed.
                    //    dns.resolve(content, function(err, addresses) {
                    //        console.log(addresses);
                    //        if (addresses === undefined) {
                    //            throw new Error("NEED_A_RECORD");
                    //        } else {
                    //
                    //        }
                    //    });
                    //
                    } else {
                        throw new Error("VALUE_ERROR");
                    }
                    check(prio, 'PRIO_ERROR').isDecimal().max(100).min(1);
                    break;
                case "SRV":
                    prio = null;
                    break;
                case "TXT":
                    prio = null;
                    break;
                default:
                    throw new Error("TYPE_ERROR");
            }
        } catch (e) {
            console.log(e);
            req.flash('error', res.__(e.message));
            return res.redirect('/domain/' + req.params.domain);
        }
*/

        Domain.checkOwner(req.params.domain, req.session.user.name, function(err, doc) {
            // console.log(doc);
            if (err) {
                // console.log(err);
                // req.flash('error', err);
                return res.redirect('/domain/' + req.params.domain);
            }
            if (doc == '') {
                // console.log(err);
                req.flash('error', res.__('DOMAIN_NOT_OWNED'));
                return res.redirect('/domains');
            } else {
                // console.log(content);
                var newRecord = new Record({
                    domainId: doc.id,
                    name: name,
                    type: type,
                    content: content,
                    ttl: ttl,
                    prio: prio
                });
                // console.log(newRecord);

                // Check for duplicate record
                Record.check(newRecord, function(err, result) {
                    // console.log(err);
                    // console.log(result)
                    // console.log(JSON.stringify(result));
                    if (err) {
                        req.flash("error", err);
                        return res.redirect('/domain/' + req.params.domain);
                    }
                    if (isEmpty(result)) {
                        // Add new record to db.
                        newRecord.save(function(saveResult) {
                            // console.log(err);
                            // console.log(saveResult);
                            // if (err) {
                            //    // console.log(err);
                            //    req.flash('error', err);
                            //    return res.redirect('/domain/' + req.params.domain);
                            // }
                            req.flash('success', res.__('ADD_RECORD_SUCCESS'));
                            res.redirect('/domain/' + req.params.domain);
                        });
                    } else {
                        req.flash('error', res.__('DUPLICATE_RECORD'));
                        return res.redirect('/domain/' + req.params.domain);
                    }
                });
            }
        });
    });

    app.get('/addrecordapi', checkLogin, function(req, res) {
        res.render('record-type');
    });

    // Remove a record
    app.post('/domain/:domain/delete-record', checkLogin, function(req, res) {
        var domain = req.params.domain,
            record = parseInt(req.body.recordId),
            user = req.session.user;
        Domain.checkOwner(domain, user.name, function(err, doc) {
            if (err) {
                req.flash('error', err);
                return res.redirect('/domains');
            }
            if (doc == null) {
                req.flash('error', res.__('DOMAIN_NOT_OWNED'));
                return res.redirect('/domains');
            } else {
                Record.delete(record, function(err) {
                    if (err) {
                        req.flash('error', err);
                        return res.redirect('/domain/' + domain);
                    }
                    req.flash('success', res.__('RECORD_DELETED'));
                    res.redirect('/domain/' + domain);
                });
            }
        });
    });

    // Edit a record
    app.post('/domain/:domain/edit-record', checkLogin, function(req, res) {
        var domain = req.params.domain,
            user = req.session.user;
        Domain.checkOwner(domain, user.name, function(err, doc) {
            if (err) {
                req.flash('error', err);
                return res.redirect('/domains');
            }
            if (doc == null) {
                req.flash('error', res.__('DOMAIN_NOT_OWNED'));
                return res.redirect('/domains');
            } else {
                // Validate user input and update record.
                var id = req.body.recordId,
                    type = req.body.type,
                    name = req.body.name == '@'?req.params.domain:req.body.name + '.' + req.params.domain,
                    ttl = req.body.ttl,
                    prio = req.body.prio,
                    content = req.body.content;
                // TODO Check user inputs for record validity
                // Better RegEx required.
                try {
                    check(type, 'TYPE_ERROR').isIn([
                        "A",
                        "AAAA",
                        "CNAME",
                        "NS",
                        "MX",
                        "SRV",
                        "TXT"
                    ]);
                    check(ttl, 'TTL_ERROR').isDecimal().min(60);
                    switch (type) {
                        case "A":
                            check(content, 'NEED_IPV4').isIPv4();
                            prio = null;
                            break;
                        case "AAAA":
                            check(content, 'NEED_IPV6').isIPv6();
                            prio = null;
                            break;
                        case "CNAME":
                            if (tld.isValid(content) && tld.tldExists(content)) {
                                prio = null;
                            } else {
                                throw new Error("VALUE_ERROR");
                            }
                            break;
                        case "NS":
                            if (tld.isValid(content) && tld.tldExists(content)) {
                                prio = null;
                            } else {
                                throw new Error("VALUE_ERROR");
                            }
                            break;
                        case "MX":
                            if (tld.isValid(content) && tld.tldExists(content)) {
                                /*  Better DNS check module needed.
                                 dns.resolve(content, function(err, addresses) {
                                 console.log(addresses);
                                 if (addresses === undefined) {
                                 throw new Error("NEED_A_RECORD");
                                 } else {

                                 }
                                 });
                                 */
                            } else {
                                throw new Error("VALUE_ERROR");
                            }
                            check(prio, 'PRIO_ERROR').isDecimal().max(100).min(1);
                            break;
                        case "SRV":
                            break;
                        case "TXT":
                            prio = null;
                            break;
                        default:
                            throw new Error("TYPE_ERROR");
                    }
                } catch (e) {
                    console.log(e);
                    req.flash('error', res.__(e.message));
                    return res.redirect('/domain/' + req.params.domain);
                }
                var newRecord = new Record({
                    id: id,
                    name: name,
                    type: type,
                    content: content,
                    ttl: ttl,
                    prio: prio
                });
                Record.edit(newRecord, function(err) {
                    if (err) {
                        req.flash('error', err);
                        return res.redirect('/domain/' + domain);
                    }
                    req.flash('success', res.__('RECORD_UPDATED'));
                    res.redirect('/domain/' + domain);
                });
            }
        });
    })

    // Server status
    app.get('/status', checkLogin, function(req, res) {
        res.render('status', {
            title: res.__('SERVER_STATUS') + ' - ' + config.siteName,
            siteName: config.siteName,
            siteTagline: config.siteTagline,
            allowReg: config.allowReg,
            user: req.session.user,
            powerservers: config.powerservers,
            success: req.flash('success').toString(),
            error: req.flash('error').toString()
        });
    });

    app.get('/statusapi/:server', checkLogin, function(req, res) {
        var server = req.params.server,
            status = null,
            sock = new net.Socket();
        sock.setTimeout(3000);
        sock.on('connect', function() {
            console.log(server + ' is up.');
            res.send("0");
            sock.destroy();
        }).on('error', function(e) {
            console.log(server + ' is down: ' + e.message);
            res.send("1");
        }).on('timeout', function(e) {
            console.log(server + ' is down: timeout');
            res.send("2");
        }).connect(53, server);
    });

    /* About page */
    app.get('/about', function(req, res) {
        res.render('about', {
            title: res.__('ABOUT') + ' - ' + config.siteName,
            siteName: config.siteName,
            siteTagline: config.siteTagline,
            allowReg: config.allowReg,
            user: req.session.user,
            success: req.flash('success').toString(),
            error: req.flash('error').toString()
        });
    });


    /*
    * Contact page
    * */
    app.get('/contact', function(req, res) {
        res.render('contact', {
            title: res.__('CONTACT') + ' - ' + config.siteName,
            siteName: config.siteName,
            siteTagline: config.siteTagline,
            allowReg: config.allowReg,
            user: req.session.user,
            success: req.flash('success').toString(),
            error: req.flash('error').toString()
        });
    });

    app.post('/contact', function(req, res) {
        // Get user IP address.
        var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

        var reply = req.body.email || req.session.user.email,
            subject = req.body.subject + " - " + config.siteName,
            body = req.body.message + '\n\n' + res.__('IP_ADDR')  + ip;

        // console.log(ip);
        // console.log(from);
        // console.log(to);
        // console.log(subject);
        // console.log(body);

        try {
            check(reply, 'EMAIL_INVALID').isEmail()
        } catch (e) {
            req.flash('error', res.__(e.message));
            return res.redirect('/contact');
        }
        // console.log(reply);

        // setup e-mail data with unicode symbols
        var mailOptions = {
            from: config.serviceMailSender, // sender address
            to: config.adminMail, // list of receivers
            replyTo: reply,
            subject: subject, // Subject line
            text: body // plaintext body
        }

        // console.log('executed');
        // send mail with defined transport object
        smtpTransport.sendMail(mailOptions, function(err, response) {
            // console.log('executed');
            if (err) {
                console.log(err);
                req.flash('error', err);
                return res.redirect('/contact');
            } else {
                req.flash('success', res.__('MSG_SENT'))
                res.redirect('/');
            }

            // if you don't want to use this transport object anymore, uncomment following line
            //smtpTransport.close(); // shut down the connection pool, no more messages
        });
    });

    /*
    * Admin routes
    * */

    // Admin dashboard
    app.get('/admin', checkLogin, function(req, res) {
        // console.log(req.session.user);
        User.check(req.session.user.name, req.session.user.email, function(err, user) {
            // console.log(user);
            if (err) {
                req.flash('error', err);
                return res.redirect('/');
            }
            if(user.role != 'admin') {
                req.flash('error', res.__('NO_PERMISSION'));
                return res.redirect('/');
            } else {
                Admin.stats(function(err, stats) {
                    if (err) {
                        req.flash('error', err);
                    }
                    res.render('admin', {
                        siteName: config.siteName,
                        siteTagline: config.siteTagline,
                        title: res.__('ADMIN_INDEX') + ' - ' + config.siteName,
                        allowReg: config.allowReg,
                        user: req.session.user,
                        stats: stats,
                        success: req.flash('success').toString(),
                        error: req.flash('error').toString()
                    });
                });
            }
        });
    });

     // Get users list
    app.get('/admin/userlist', checkLogin, function(req, res) {
        var page = req.query.p?parseInt(req.query.p):1,
            limit = req.query.limit?parseInt(req.query.limit):50;
        // Check user has permission to access admin dashbord.
        User.check(req.session.user.name, req.session.user.email, function(err, user) {
            if (err) {
                req.flash('error', err);
                return res.redirect('/');
            }
            if(user.role != 'admin') {
                req.flash('error', res.__('NO_PERMISSION'));
                return res.redirect('/');
            } else {
                Admin.userlist(page, limit, function(err, users) {
                    if(err) {
                        users = [];
                        req.flash('error', err);
                    }
                    res.render('userlist', {
                        siteName: config.siteName,
                        siteTagline: config.siteTagline,
                        title: res.__('USERS_LIST') + ' - ' + config.siteName,
                        allowReg: config.allowReg,
                        user: req.session.user,
                        users: users,
                        paginationData: users,
                        page: page,
                        success: req.flash('success').toString(),
                        error: req.flash('error').toString()
                    });
                });
            }
        });
    });

    app.post('/admin/adduser', checkLogin, function(req, res) {
        User.check(req.session.user.name, req.session.user.email, function(err, user) {
            if (err) {
                req.flash('error', err);
                return res.redirect('/');
            }
            if(user.role != 'admin') {
                req.flash('error', res.__('NO_PERMISSION'));
                return res.redirect('/');
            } else {
                var name = req.body.username,
                    mail = req.body.email,
                    password = req.body.password,
                    repeatPassword = req.body['password-repeat'],
                    role = req.body.role;

                try {
                    check(name, 'USERNAME_EMPTY').notEmpty();
                    check(name, 'USERNAME_ALPHANUMERIC').isAlphanumeric();
                    check(password, 'PASSWORD_EMPTY').notEmpty();
                    check(repeatPassword, 'PASSWORD_NOT_EQUAL').equals(password);
                    check(mail, 'EMAIL_INVALID').len(4, 64).isEmail();
                } catch (e) {
                    req.flash('error', res.__(e.message));
                    return res.redirect('/admin/userlist');
                }

                // get password hash
                var hash = crypto.createHash('sha256'),
                    password = hash.update(req.body.password).digest('hex');
                var newUser = new User({
                    name: name,
                    password: password,
                    email: mail,
                    role: role
                });
                // check if username exists.
                User.check(newUser.name, newUser.email, function(err, user){
                    // console.log(user);
                    if(user) {
                        err = 'USER_EXISTS';
                    }
                    if(err) {
                        req.flash('error', res.__(err));
                        return res.redirect('/admin/userlist');
                    }
                    newUser.save(function(err){
                        if(err){
                            req.flash('error',err);
                            return res.redirect('/reg');
                        }
                        req.flash('success',res.__('ADD_USER_SUCCESS'));
                        res.redirect('/admin/userlist');
                    });
                });
            }
        });
    });

    app.post('/admin/deleteuser', checkLogin, function(req, res) {
        // console.log(req.body.username);
        User.check(req.session.user.name, req.session.user.email, function(err, user) {
            if (err) {
                req.flash('error', err);
                return res.redirect('/');
            }
            if(user.role != 'admin') {
                req.flash('error', res.__('NO_PERMISSION'));
                return res.redirect('/');
            } else {
                Domain.getList(req.body.username, function(err, domains) {
                   if (err) {
                       req.flash('error', err);
                       return res.redirect('/admin/userlist');
                   }
                   // console.log(domains);
                    User.delete(req.body.username, function(err) {
                        if (err) {
                            req.flash('error', err);
                            return res.redirect('/admin/userlist');
                        }
                        async.eachSeries(domains, function(domain, callback) {
                            console.log(domain);
                            Domain.remove(domain.id, req.body.username, function(err) {
                                if (err) {
                                    req.flash('error', err);
                                    return res.redirect('/admin/userlist');
                                }
                                callback (null);
                            });
                        }, function(err) {
                            if (err) {
                                req.flash('error', err);
                                return res.redirect('/admin/userlist');
                            }
                            console.log('executed');
                        });
                        req.flash('success', res.__('DELETE_USER_SUCCESS'));
                        res.redirect('/admin/userlist');
                    });

                });
            }
        });
    });

    app.post('/admin/edituser', checkLogin, function(req, res) {
        var username = req.body.username,
            email = req.body.email,
            role = req.body.role,
            password = req.body.password,
            repeatPassword = req.body['password-repeat'],
            inputError = '';

        try {
            check(email, 'EMAIL_INVALID').len(4, 64).isEmail();
            check(password, 'PASSWORD_EMPTY').notEmpty();
        } catch (e) {
            inputError = e.message;
        }

        if (password === repeatPassword) {
            var hash = crypto.createHash('sha256'),
                password = hash.update(req.body.password).digest('hex');
            var hash = crypto.createHash('sha256'),
                repeatPassword = hash.update(repeatPassword).digest('hex');

        } else {
            inputError = 'PASSWORD_NOT_EQUAL';
        }

        if (inputError) {
            req.flash('error', res.__(inputError));
            return res.redirect('/admin/userlist');
        }

        var newUser = new User({
            name: username,
            email: email,
            password: password,
            role: role
        });

        Admin.useredit(newUser, function(err, user){
            if(err) {
                req.flash('error', res.__(err));
                return res.redirect('/admin/userlist');
            }
            req.flash('success', res.__('USER_UPDATED'));
            res.redirect('/admin/userlist');
        });
    });

    app.get('/admin/domainlist', checkLogin, function(req, res) {
        var page = req.query.p?parseInt(req.query.p):1,
            limit = req.query.limit?parseInt(req.query.limit):50;
        // Check user has permission to access admin dashbord.
        User.check(req.session.user.name, req.session.user.email, function(err, user) {
            if (err) {
                req.flash('error', err);
                return res.redirect('/');
            }
            if(user.role != 'admin') {
                req.flash('error', res.__('NO_PERMISSION'));
                return res.redirect('/');
            } else {
                Admin.domainlist(page, limit, function(err, domains) {
                    if(err) {
                        domains = [];
                        req.flash('error', err);
                    }
                    res.render('domainlist', {
                        siteName: config.siteName,
                        siteTagline: config.siteTagline,
                        title: res.__('DOMAINS_LIST') + ' - ' + config.siteName,
                        allowReg: config.allowReg,
                        user: req.session.user,
                        domains: domains,
                        paginationData: domains,
                        page: page,
                        success: req.flash('success').toString(),
                        error: req.flash('error').toString()
                    });
                });
            }
        });
    });

    app.post('/admin/adddomain', checkLogin, function(req, res) {
        console.log(req.body.belongs);
        User.check(req.session.user.name, req.session.user.email, function(err, user) {
            if (err) {
                req.flash('error', err);
                return res.redirect('/');
            }
            if(user.role != 'admin') {
                req.flash('error', res.__('NO_PERMISSION'));
                return res.redirect('/');
            } else {
                var newDomain = new Domain({
                    name: req.body.domain,
                    belongs: req.body.belongs
                });
                if (tld.getDomain(newDomain.name) == newDomain.name && tld.tldExists(newDomain.name)) {
                    // Domain valid, check if domain exists in db.
                    Domain.check(newDomain.name, function(err, data) {
                        if (data) {
                            // console.log(data);
                            // Domain exists, return error.
                            req.flash('error', res.__('DOMAIN_EXISTS'));
                            return res.redirect('/admin/domainlist');
                        } else {
                            // Check for owner.
                            User.check(req.body.belongs, null, function(err, user) {
                                if (!user) {
                                    req.flash('error', res.__('USER_NOT_EXIST'));
                                    return res.redirect('/admin/domainlist');
                                }
                                // Domain not exist, insert into database.
                                newDomain.save(function(err) {
                                    if (err) {
                                        res.redirect('/admin/domainlist');
                                        return req.flash('error',err);
                                    }
                                    req.flash('success',res.__('ADD_DOMAIN_SUCCESS'));
                                    res.redirect('/admin/domainlist');
                                });
                            });
                        }
                    });
                } else {
                    req.flash('error', res.__('DOMAIN_NOT_VALID'));
                    return res.redirect('/domainlist');
                }
            }
        });
    });

    app.post('/admin/editdomain', checkLogin, function(req, res) {
        // console.log(req.body.domainId);
        // console.log(req.body.belongs);
        User.check(req.session.user.name, req.session.user.email, function(err, user) {
            if (err) {
                req.flash('error', err);
                return res.redirect('/');
            }
            if(user.role != 'admin') {
                req.flash('error', res.__('NO_PERMISSION'));
                return res.redirect('/');
            } else {
                User.check(req.body.belongs, null, function(err, user) {
                    if (!user) {
                        req.flash('error', res.__('USER_NOT_EXIST'));
                        return res.redirect('/admin/domainlist');
                    }
                    // Domain not exist, insert into database.
                    Admin.editdomain(parseInt(req.body.domainId), req.body.belongs, function(err) {
                        if (err) {
                            req.flash('error', err);
                            return res.redirect('/admin/domainlist');
                        } else {
                            req.flash('success', res.__('DOMAIN_UPDATED'));
                            res.redirect('/admin/domainlist');
                        }
                    });
                });
            }
        });
    });

    app.post('/admin/deletedomain', checkLogin, function(req, res) {
        // console.log(req.body.domainId);
        console.log(req.body.belongs);
        User.check(req.session.user.name, req.session.user.email, function(err, user) {
            if (err) {
                req.flash('error', err);
                return res.redirect('/admin/domainlist');
            }
            if(user.role != 'admin') {
                req.flash('error', res.__('NO_PERMISSION'));
                return res.redirect('/');
            } else {
                Domain.remove(parseInt(req.body.domainId), req.body.belongs, function(err) {
                    if (err) {
                        req.flash('error', err);
                        return res.redirect('/admin/domainlist');
                    }
                    req.flash('success', res.__('DOMAIN_DELETED'));
                    res.redirect('/admin/domainlist');
                });
            }
        });
    });


    // TODO A default 404 page.

    // Session functions
    function checkLogin(req, res, next) {
        if(!req.session.user) {
            req.flash('error', res.__('LOGIN_NEEDED'));
            return res.redirect('/login');
        }
        next();
    }

    function checkNotLogin(req, res, next) {
        if(req.session.user) {
            req.flash('error', res.__('ALREADY_LOGIN'));
            return res.redirect('/');
        }
        next();
    }

};
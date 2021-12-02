//jshint esversion:6
require('dotenv').config(); // load environment variables from .env file
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");
// to support session
const session = require('express-session');
// use passport for authentication, cookies, session
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose"); // passport-local is a dependency needed by passport-local-mongoose
// 
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook');
const findOrCreate = require('mongoose-findorcreate');

const app = express();

// const path = require('path');
app.use(express.static(__dirname));
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({
  extended: true
}));

// set up session
app.use(session({
  secret: "Our little secret.", // best to use environment variable
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize()); // step 1 for using passport
app.use(passport.session()); // step 2 let passport deals with session

// development & production setting
let mongodbUrl;
let googleCallback;
let facebookCallback;
if (process.env.PORT) {
  mongodbUrl = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PWD}@cluster0.fofmj.mongodb.net/diary-we-write`;
  let domain = "http://localhost";
  if (process.env.DOMAIN) {
    domain = process.env.DOMAIN;
  }
  googleCallback = `${domain}:${process.env.PORT}/auth/google/diaries`;
  facebookCallback = `${domain}:${process.env.PORT}/auth/facebook/diaries`;
 } else {
  googleCallback = "http://localhost:3000/auth/google/diaries";
  facebookCallback = "http://localhost:3000/auth/facebook/diaries";
  mongodbUrl = "mongodb://localhost:27017/diary-we-write";
}
mongoose.connect(mongodbUrl, {useNewUrlParser: true, useCreateIndex: true})
// mongoose.set("useCreateIndex", true); // this is to resolve a mongoose DeprecationWarning error

// mongodb user schema
const userSchema = new mongoose.Schema ({
  email: String,
  password: String,
  googleId: String, // this field is for google OAuth
  facebookId: String,
  diaries: [{date: String, task: String}]
});

// add plugin to user schema before create the user model
userSchema.plugin(passportLocalMongoose); // step 3 let passport deals with database hashing and salting
userSchema.plugin(findOrCreate);

// mongodb user model
const User = new mongoose.model("User", userSchema);

passport.use(User.createStrategy()); // step 4 

// this setup works for not only local strategy but all
passport.serializeUser(function(user, done) { // step 5 needed for session, create cookies
  done(null, user.id);
});

passport.deserializeUser(function(id, done) { // step 6 needed for session, retrieve info from cookies
  User.findById(id, function(err, user) {
    done(err, user);
  });
});

// goes after all passport session setup
// set up passport OAuth google strategy
// this takes care of creating user account in our mongobd database, we only store googleId, no password in database
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID, // our app's client ID given by google
    clientSecret: process.env.GOOGLE_CLIENT_SECRET, // our app's client secret given by google
    callbackURL: googleCallback, // must be the same one we set in google API panel
    userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo" // this is for google+'s API sunsetting
  },
  function(accessToken, refreshToken, profile, cb) { // callback function, profile contains user info
    // console.log(profile)
    User.findOrCreate({ googleId: profile.id }, function (err, user) {
      return cb(err, user);
    });
  }
));

// facebook login
passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL: facebookCallback
  },
  function(accessToken, refreshToken, profile, cb) {
    // console.log('profile', profile);
    User.findOrCreate({ facebookId: profile.id }, function (err, user) {
      return cb(err, user);
    });
  }
));

app.get("/", function(req, res){
  if (req.isAuthenticated()){
    res.redirect("/diaries");
  } else {
    res.render("home");
  }
});

// passport OAuth step 1
// when user click on a button linked to this route
app.get("/auth/google",
  // implement passport OAuth google strategy, ask for user profile information
  passport.authenticate('google', { scope: ["profile"] })
);

// passport OAuth step 2
// we set up in google APIs panel to redirect to this link
app.get("/auth/google/diaries",
  passport.authenticate('google', { failureRedirect: "/login" }), // if authentication fail, send user to /login
  function(req, res) {
    // Successful authentication, redirect to secrets.
    res.redirect("/diaries");
  }
);

// facebook
app.get('/auth/facebook',
  passport.authenticate('facebook'));

app.get('/auth/facebook/diaries',
  passport.authenticate('facebook', { failureRedirect: '/login' }),
  function(req, res) {
    // Successful authentication, redirect home.
    res.redirect('/diaries');
  });  

app.get("/login", function(req, res){
  res.render("login");
});

app.get("/register", function(req, res){
  res.render("register");
});

app.get("/diaries", function(req, res){
  // here we need to check if user is authenticated already
  // if (req.isAuthenticated()){
  //   res.render("diaries");
  // } else {
  //   res.redirect("/login");
  // }

  // today's date in MM/DD/YYYY format
  const today = new Date();
  const dateArray = [today.getMonth()+1, today.getDate(), today.getFullYear()];
  const todayDate = dateArray.join("/");
  // User.find({"diaries.date": {$ne: null}}, ) find field not equal to null
  User.find({"diaries.date": {$eq: todayDate}}, function(err, foundUsers){ // users who have post today
    if (err){
      console.log(err);
    } else {
      if (foundUsers) {
        res.render("diaries", {usersWithdiaries: foundUsers, submittedDate: todayDate});
      }
    }
  });
});

app.get("/submit", function(req, res){
  // here we check if user is authenticated already
  // passport adds isAuthenticated() function on req to check authentication state based on saved cookies
  if (req.isAuthenticated()){
    res.render("submit");
  } else {
    res.redirect("/login");
  }
});

// user can post as many as they want, but database only keep the newest one
app.post("/submit", function(req, res){
  // get date
  const today = new Date();
  const dateArray = [today.getMonth()+1, today.getDate(), today.getFullYear()];
  const todayDate = dateArray.join("/");
  // date and content
  const submitteddiary = {
    date: todayDate,
    task: req.body.diary
  }

  //Once the user is authenticated and their session gets saved, their user details are saved to req.user.
  function userHasDate(diaries, date) {
    let found = false
    diaries.forEach(diaryObj => {
      if(diaryObj.date === date) {
        found = true;
      }
    })
    return found;
  }

  User.findById(req.user.id, function(err, foundUser){
    if (err) {
      console.log(err);
    } else {
      if (foundUser) { // locate the user data
        const hasDate = userHasDate(foundUser.diaries, todayDate);
        if (hasDate) { // if user has already submitted today
          foundUser.diaries.forEach( diary => {
            if (diary.date === todayDate) {
              diary.task = submitteddiary.task; // replace old one with new submit
            }
          })
        } else {
          foundUser.diaries.push(submitteddiary);
        }
        foundUser.save(function(){ // save
          res.redirect("/diaries");
        });
      }
    }
  });
});

app.get("/logout", function(req, res){
  // passport sets up a logout() function on req for us to end the user session
  req.logout();
  res.redirect("/");
});

// when user submit register form
app.post("/register", function(req, res){
  // passport-local-mongoose pacakge supports .register method which establish a session
  User.register({username: req.body.username}, req.body.password, function(err, user){
    if (err) {
      console.log(err);
      res.redirect("/register");
    } else { 
      // use passport to authenticate user, "local" is the type of authentication strategy
      passport.authenticate("local")(req, res, function(){
        // this callback only triggers when authentication is successful
        res.redirect("/diaries");
      });
    }
  });

});

// when user log in
// app.post("/login", function(req, res){

//   const user = new User({
//     username: req.body.username,
//     password: req.body.password
//   });
//   // passport sets up a login() function on req for us to establish a login session
//   req.login(user, function(err){
//     if (err) {
//       console.log(err)
//     } else {
//       // use passport to authenticate user, "local" is the type of authentication strategy
//       passport.authenticate("local")(req, res, function(){
//         res.redirect("/diaries");
//       });
//     }
//   });

// });

app.post("/login", function(req, res){

  const user = new User({
    username: req.body.username,
    password: req.body.password
  });
  
  passport.authenticate('local', (err, user, info) => {
     if(err || !user) {
       res.redirect("/login")
     } else {
       req.login(user, function(err){
         if (err) {
          console.log(err)
         } else {
           res.redirect("/diaries")
         }
       })
     }
  })(req, res)

});

app.listen(process.env.PORT || 3000, function(){
  if (process.env.PORT){
      console.log(`Server started on port ${process.env.PORT}`);
  } else {
      console.log("Server started on port 3000");
  }
  
});

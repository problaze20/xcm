const Datastore = require('nedb');
const path = require('path');
const { app } = require('electron');

const db = new Datastore({
  filename: path.join(app.getPath('userData'), 'clipboard.db'), // stores the DB in a safe persistent location
  autoload: true
});

module.exports = db;

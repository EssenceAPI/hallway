#!/usr/bin/env node

var program = require('commander');

program
  .usage('-s <synclet> -p <profile@service>')
  .option('-s, --synclet <synclet>', 'the synclet to test')
  .option('-p, --profile <profile@service>', 'the profile to test against')
  .option('-v, --verbose', 'display the full JSON output')
  .parse(process.argv);

if (!program.synclet || !program.profile) {
  program.help();
}

var path = require('path');
var async = require('async');

var dal = require('dal');
var ijod = require('ijod');
var logger = require('logger').logger('testSynclet');
var profileManager = require('profileManager');

var profile = program.profile;
var synclet = program.synclet;

var service = profile.split('@')[1];

logger.info('Running %s/%s for %s', service, synclet, profile);

function exitWithError() {
  logger.info.apply(logger, arguments);

  process.exit(1);
}

var runs = 0;

function terse(data) {
  var terseData = Object.keys(data);

  terseData = terseData.map(function (key) {
    var result = {};

    if (Array.isArray(data[key])) {
      result[key] = data[key].length;
    } else {
      result[key] = data[key];
    }

    return result;
  });

  return terseData;
}

function runService(paginationPi, cb) {
  dal.query('SELECT service FROM Profiles WHERE id=?', [profile],
    function (error, rows) {
    if (error) {
      exitWithError('Error finding the profile %s: %s', profile, error);
    }

    if (rows.length !== 1 || rows[0].service !== service) {
      exitWithError('Did not find a valid profile for %s', service);
    }

    profileManager.allGet(profile, function (error, pi) {
      if (error) {
        exitWithError('Error getting profile information for %s: %s',
          profile, error);
      }

      if (!pi.auth) {
        exitWithError('No auth information was found for the profile %s,' +
          ' you must auth before you can run the synclet.', profile);
      }

      // TODO: Refactor this hack
      if (paginationPi) {
        pi = paginationPi;
        pi.config.nextRun = 0;
      }

      try {
        var mod = require(path.join(__dirname, '/../lib', 'services', service,
          synclet) + '.js');

        if (!mod) {
          exitWithError('Could not find the synclet for %s/%s', service,
            synclet);
        }

        mod.sync(pi, function (error, data) {
          if (error) {
            exitWithError('%s/%s error: %s', service, synclet, error);
          }

          var returned;

          if (program.verbose) {
            returned = JSON.stringify(data.data, null, 2);
          } else {
            returned = JSON.stringify(terse(data.data));
          }

          logger.info('%d %s/%s: %s', runs, service, synclet, returned);

          cb(data);
        });
      } catch (e) {
        exitWithError('Exception running %s/%s: %s', service, synclet, e);
      }
    });
  });
}

ijod.initDB(function () {
  var queue = [null];

  async.whilst(function () {
    return queue.length > 0;
  }, function (whilstCb) {
    runs++;

    runService(queue.pop(), function (data) {
      if (data.config && data.config.nextRun === -1) {
        queue.push(data);
      }

      whilstCb();
    });
  }, function () {
    process.exit(0);
  });
});

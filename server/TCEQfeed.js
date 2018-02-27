// required packages
import chokidar from 'chokidar';

const filepath = '/hnet/incoming/TCEQ/current/';

const fs = Npm.require('fs');
const pathModule = Npm.require('path');

var makeObj = function(keys, startIndex, previousObject) {
  let obj = {
    measurement: keys[2],
    poc: keys[3],
    method: keys[4], 
    units: keys[5],
    value: keys[6],
    flag: [keys[7]],
    slope: keys[9],
    intercept: keys[10]
  };
  return obj;
};

var batchTCEQDataUpsert = Meteor.bindEnvironment(function(parsedLines, path) {
  // Find the site information using the location of the file that is being read
  const pathArray = path.split(pathModule.sep);
  const parentDir = pathArray[pathArray.length - 2];
  
    // Update the timestamp for the last update for the site
    const stats = fs.statSync(path);
    const fileModified = moment(Date.parse(stats.mtime)).unix(); // from milliseconds into moments and then epochs

    // Create objects from parsed lines
    const allObjects = [];
    let previousObject = {};
    for (let k = 0; k < parsedLines.length; k++) {
      let singleObj = {};
      if (k === 0) {
          singleObj = makeObj(parsedLines[k], 1);
      } else {
          singleObj = makeObj(parsedLines[k], 1, previousObject);
      }
        let epoch = moment(parsedLines[k][1].toString(), "YYYYMMDDHHmmss").unix();
        epoch = epoch - (epoch % 1); //round down
        singleObj.epoch = epoch;
        singleObj.timestamp = moment(parsedLines[k][1].toString(),
                                         "YYYYMMDDHHmmss").format(
                                           "dddd, MMMM Do YYYY, h:mm:ss a"); //Monday, July 17th 2017, 1:44:52 pm                     

        singleObj.site = parsedLines[k][0];
        singleObj.file = pathArray[pathArray.length - 1];
        singleObj._id = parsedLines[k][0] + '_' + parsedLines[k][1];
        let $set = {};
        let obj = makeObj(parsedLines[k], 1);
        let found = TCEQData.findOne({
          _id: singleObj._id,
          subTypes: {$elemMatch: {measurement: obj.measurement, poc: obj.poc}}
        }) != null;

        if (found) {
          // This measurement and POC already exist in the DB
          // Update the single measurement (embedded doc) to new field values
          // Note: append the new flag instead of overwrite
          logger.info("Found: " + singleObj._id + " " + obj.measurement + " " + obj.poc);
          logger.info("obj.flag[0]: " + obj.flag[0]);
          TCEQData.update(
            {
              _id: singleObj._id,
              "subTypes.measurement": obj.measurement,
              "subTypes.poc": obj.poc
            },
            { 
              $set: {
                "subTypes.$": obj
              }
            }
          );

        } else {
          // This measurement and POC do not exist in the DB yet
          // Push the measurement (embedded doc) to the subtypes array
          TCEQData.update(
            {
              _id: singleObj._id,
              epoch: singleObj.epoch,
              timestamp: singleObj.timestamp,
              site: singleObj.site
            },
            { $push: { subTypes: obj } },
            { upsert: true }
          );
        }
        
        previousObject = singleObj;
    }

    bulkCollectionUpdate(TCEQData, allObjects, {
      callback: function() {
        const nowEpoch = moment().unix();
        const agoEpoch = moment.unix(fileModified).subtract(24, 'hours').unix();
      }
    });
});

const readFile = Meteor.bindEnvironment(function(path) {
    fs.readFile(path, 'utf-8', (err, output) => {
      let secondIteration = false;
        Papa.parse(output, {
          header: false,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete(results) {
            if (!secondIteration) {
              batchTCEQDataUpsert(results.data, path);
              secondIteration = true;
            } else {
              return;
            }
          }
        });
    });
});

const tceqWatcher = chokidar.watch(filepath, {
  ignored: /[\/\\]\./,
  ignoreInitial: true,
  usePolling: true,
  persistent: true
});

tceqWatcher.on('add', (path) => {
  logger.info('File ', path, 'has been added.');
  readFile(path);
}).on('change', (path) => {
  logger.info('File', path, 'has been changed');
  readFile(path);
}).on('addDir', (path) => {
  logger.info('Directory ', path, 'has been added');
}).on('error', (error) => {
  logger.error('Error happened', error);
}).on('ready', () => {
  logger.info('Ready for changes in ' + filepath +'.');
});

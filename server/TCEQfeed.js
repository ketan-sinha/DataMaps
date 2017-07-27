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
    flag: keys[7],
    slope: keys[9],
    intercept: keys[10]
  };
  //let metron = [];
  // logger.info("keys: " + keys);
  
  //   for (const key in keys) {
  //   logger.info("KEY: " + key + " " + keys.hasOwnProperty(key));
  //   if (keys.hasOwnProperty(key)) {

  //     let newKey = key;
  //     logger.info("keys[newKey]: " + keys[newKey]);
  //     const subKeys = newKey.split('_'); // split each column header
  //     logger.info("subKeys: " + subKeys + 
  //                 " subKeys length: " + subKeys.length);
  //     if (newKey > startIndex) { // skipping e.g. 'TheTime'
  //       metron = subKeys[3]; // instrument i.e. Wind, Ozone etc.
  //       logger.info("metron: " + metron);
  //       const measurement = subKeys[3]; // measurement conc, temp, etc.
  //       const value = keys[key];
  //       let unitType = 'NA';
        
  //       if (subKeys[4] !== undefined) {
  //         unitType = subKeys[4]; // unit
  //       }
        
  //       if (!obj.subTypes[metron]) {
  //         obj.subTypes[metron] = [
  //           {
  //             metric: measurement,
  //             val: value,
  //             unit: unitType
  //           }
  //         ];
  //       } else {
  //         if (measurement === 'Flag') { // Flag should be always first
  //           obj.subTypes[metron].unshift({ metric: measurement, val: value });
  //         } else {
  //           obj.subTypes[metron].push({ metric: measurement, val: value, unit: unitType });
  //         }
  //       }
  //     }
  //   }
  // }

  // for (var subType in obj.subTypes) {
  //   if (obj.subTypes.hasOwnProperty(subType)) {
  //     // automatic flagging of 03 values to be flagged with 9(N)
  //     if (subType === 'O3' || subType === '49i') {
  //       // condition: O3 value above 250
  //       if (obj.subTypes[subType][1].val > 250) {
  //         obj.subTypes[subType][0].val = 9;
  //       }
  //       // if a O3 value changes for more than 30 ppb from previous value
  //       if (previousObject) {
  //         const diff = obj.subTypes[subType][1].val - previousObject.subTypes[subType][1].val;
  //         if (diff >= 30) {
  //           obj.subTypes[subType][0].val = 9;
  //         }
  //       }
  //     }
  //   }
  // }

  return obj;
};

var batchTCEQDataUpsert = Meteor.bindEnvironment(function(parsedLines, path) {
  // find the site information using the location of the file that is being read
  const pathArray = path.split(pathModule.sep);
  const parentDir = pathArray[pathArray.length - 2];
  // const site = Live.findOne({ incoming: parentDir });
  // logger.info('parsedLines length: ' + parsedLines.length);
  // logger.info('[0] ' + parsedLines[0] );
  // logger.info('[0][0]' + parsedLines[0][0]);
  
    // update the timestamp for the last update for the site
    const stats = fs.statSync(path);
    const fileModified = moment(Date.parse(stats.mtime)).unix(); // from milliseconds into moments and then epochs
    // if (site.lastUpdateEpoch < fileModified) {
    //   TCEQData.update({
    //     // Selector
    //     AQSID: `${site.AQSID}`
    //   }, {
    //     // Modifier
    //     $set: {
    //       lastUpdateEpoch: fileModified
    //     }
    //   }, { validate: false });
    // }

    // create objects from parsed lines
    const allObjects = [];
    let previousObject = {};
    for (let k = 0; k < parsedLines.length; k++) {
      let singleObj = {};
      if (k === 0) {
          singleObj = makeObj(parsedLines[k], 1);
      } else {
          singleObj = makeObj(parsedLines[k], 1, previousObject);
      }
        // logger.info(parsedLines[k]);
        let epoch = moment(parsedLines[k][1].toString(), "YYYYMMDDHHmmss").unix();
        epoch = epoch - (epoch % 1); //round down
        singleObj.epoch = epoch;
        singleObj.timestamp = moment(parsedLines[k][1].toString(),
                                         "YYYYMMDDHHmmss").format(
                                           "dddd, MMMM Do YYYY, h:mm:ss a" //Monday, July 17th 2017, 1:44:52 pm
                                         );
        logger.info("timestamp: " + singleObj.timestamp.toString());
        // logger.info('epoch is ' + epoch.toString());
        // singleObj.epoch5min = epoch - (epoch % 300);
        singleObj.site = parsedLines[k][0];
        singleObj.file = pathArray[pathArray.length - 1];
        singleObj._id = parsedLines[k][0] + '_' + parsedLines[k][1];
        let method = parsedLines[k][4];
        let measurement = parsedLines[k][2];
        let $set = {};
        $set[`subTypes.${method}.${measurement}`] = makeObj(parsedLines[k], 1);
        // allObjects.push(singleObj);
        TCEQData.update(
          {
            _id: singleObj._id,
            epoch: singleObj.epoch,
            timestamp: singleObj.timestamp
          },
          {
            $set: $set
          },
          {
            upsert: true
          }
        );
        previousObject = singleObj;
        //let singleObj = {};

        // let epoch = moment(parsedLines[k][1], "YYYYMMDDHHMMSS").unix();
        // epoch = epoch - (epoch % 1); // rounding down
        // logger.info("epoch is " + epoch.format(String));
        // singleObj.epoch = epoch;
        // singleObj.epoch5min = epoch - (epoch % 300);
        // singleObj.theTime = parsedLines[k].TheTime;
        // singleObj.site = site.AQSID;
        // singleObj.file = pathArray[pathArray.length - 1];
        // singleObj._id = `${site.AQSID}_${epoch}`;
        // allObjects.push(singleObj);
        // previousObject = singleObj;
    }

    // using bulkCollectionUpdate
    bulkCollectionUpdate(TCEQData, allObjects, {
      callback: function() {
        const nowEpoch = moment().unix();
        const agoEpoch = moment.unix(fileModified).subtract(24, 'hours').unix();

        // logger.info(`TCEQData updated from: ${path} for: ${parsedLines[k][0]}`);
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

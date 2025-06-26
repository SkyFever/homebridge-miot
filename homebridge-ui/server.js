const {
  HomebridgePluginUiServer
} = require('@homebridge/plugin-ui-utils');
const MiCloud = require('../lib/protocol/MiCloud');
const Errors = require("../lib/utils/Errors.js");
const MiotSpecClassGenerator = require('../lib/tools/MiotSpecClassGenerator');
const MiotSpecFetcher = require('../lib/protocol/MiotSpecFetcher');
const Logger = require("../lib/utils/Logger");

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    // super must be called first
    super();

    this.onRequest('/get-all-devices', this.getAllDevices.bind(this));
    this.onRequest('/get-all-devices-from-config', this.getAllDevicesFromConfig.bind(this));
    this.onRequest('/generate-device-class', this.generateDeviceClass.bind(this));
    this.onRequest('/get-device-metadata', this.getDeviceMetadata.bind(this));

    // this.ready() must be called to let the UI know you are ready to accept api calls
    this.ready();
  }

  async getAllDevices(params) {
    const miCloud = new MiCloud(new Logger());
    miCloud.setRequestTimeout(10000); // timeout 10 seconds
    var devices = [];

    // try to login
    try {
      await miCloud.login(params.username, params.password);
    } catch (err) {
      if (err instanceof Errors.TwoFactorRequired) {
        return {
          success: false,
          error: 'Two factor authentication required, please visit the specified url and retry login.',
          url: err.notificationUrl
        }
      }

      return {
        success: false,
        error: err.message + `! The specified MiCloud login credentials might be incorrect or the account does not exist...`
      };
    }

    let warningMsg = null;
    const isShowAll = !!params.isShowAll;

    // list all device from all available countries
    for (const country of miCloud.availableCountries) {
      try {
        miCloud.setCountry(country);
        // prevent duplicate devices
        const allList = (await miCloud.getDevices()).filter(device => !devices.find(d => d.did === device.did));
        let validList = allList;
        if (!isShowAll) {
          // filter out device without an local ip and without ssid (most probably bluetooth devices)
          validList = allList.filter(device => device.localip && device.localip.length > 0 && device.ssid && device.ssid.length > 0);
        }
        validList.map(device => device.country = country);
        devices.push(...validList);
      } catch (err) {
        warningMsg = `Warning - Could not retrive device list from ${country} server. Message:  ${err.message}`
      }
    }

    return {
      success: true,
      warning: warningMsg,
      devices: devices.map(device => {
        return {
          name: device.name,
          ip: device.localip,
          token: device.token,
          model: device.model,
          deviceId: device.did,
          country: device.country
        }
      })
    }
  }

  async getAllDevicesFromConfig(params) {
    try {
      // Config should be passed from UI
      const micloudConfig = params.micloudConfig;
      if (!micloudConfig) {
        return {
          success: false,
          error: 'No MiCloud configuration provided. Please configure MiCloud settings in the global configuration first.'
        };
      }

      const miCloud = new MiCloud(new Logger());
      miCloud.setRequestTimeout(micloudConfig.timeout || 10000);
      
      // Check if we have tokens or username/password
      const hasTokens = micloudConfig.serviceToken && micloudConfig.userId && micloudConfig.ssecurity;
      const hasCredentials = micloudConfig.username && micloudConfig.password;
      
      if (!hasTokens && !hasCredentials) {
        return {
          success: false,
          error: 'No MiCloud credentials found. Please configure either username/password or tokens in the global MiCloud settings.'
        };
      }

      if (hasTokens) {
        // Use token-based authentication
        miCloud.setServiceToken({
          serviceToken: micloudConfig.serviceToken,
          userId: micloudConfig.userId,
          ssecurity: micloudConfig.ssecurity
        });
      } else {
        // Use username/password authentication
        try {
          await miCloud.login(micloudConfig.username, micloudConfig.password);
        } catch (err) {
          if (err instanceof Errors.TwoFactorRequired) {
            return {
              success: false,
              error: 'Two factor authentication required. Please use token-based authentication instead.',
              url: err.notificationUrl
            };
          }
          throw err;
        }
      }

      var devices = [];
      let warningMsg = null;
      const isShowAll = !!params.isShowAll;

      // Set country
      miCloud.setCountry(micloudConfig.country || 'cn');

      // List all devices from all available countries
      for (const country of miCloud.availableCountries) {
        try {
          miCloud.setCountry(country);
          // prevent duplicate devices
          const allList = (await miCloud.getDevices()).filter(device => !devices.find(d => d.did === device.did));
          let validList = allList;
          if (!isShowAll) {
            // filter out device without an local ip and without ssid (most probably bluetooth devices)
            validList = allList.filter(device => device.localip && device.localip.length > 0 && device.ssid && device.ssid.length > 0);
          }
          validList.map(device => device.country = country);
          devices.push(...validList);
        } catch (err) {
          warningMsg = `Warning - Could not retrieve device list from ${country} server. Message: ${err.message}`;
        }
      }

      return {
        success: true,
        warning: warningMsg,
        devices: devices.map(device => {
          return {
            name: device.name,
            ip: device.localip,
            token: device.token,
            model: device.model,
            deviceId: device.did,
            country: device.country
          }
        })
      };
    } catch (err) {
      return {
        success: false,
        error: 'Failed to get devices: ' + err.message
      };
    }
  }

  async generateDeviceClass(params) {
    const storagePath = this.homebridgeStoragePath + '/miotSpecClassGenerator/devices/';
    const miotSpecClassGenerator = new MiotSpecClassGenerator(params.deviceModel, null, params.deviceName, null, params.isMiCloudRequired, storagePath);
    try {
      await miotSpecClassGenerator.generate();
      return {
        success: true,
        filePath: miotSpecClassGenerator.getOutputFilePath(),
        devType: miotSpecClassGenerator.getDeviceType()
      }
    } catch (err) {
      return {
        success: false,
        error: err.message
      }
    }
  }

  async getDeviceMetadata(params) {
    try {
      const result = await MiotSpecFetcher.fetchMiotSpecByModel(params.deviceModel, true);
      const {
        description,
        properties,
        actions,
        events
      } = result;
      return {
        success: true,
        metadata: {
          description,
          properties,
          actions,
          events
        }
      }
    } catch (err) {
      return {
        success: false,
        error: err.message
      }
    }
  }

}

// start the instance of the class
(() => {
  return new UiServer;
})();

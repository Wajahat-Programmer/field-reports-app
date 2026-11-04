/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { keepAliveTask } from './src/native/keepAlive';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
// Run by the foreground upload service; its pending promise keeps timers alive while the app is in the background.
AppRegistry.registerHeadlessTask('UploadKeepAlive', () => keepAliveTask);

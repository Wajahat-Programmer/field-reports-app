import local from './config.local';

export const config = {
  baseUrl: local.baseUrl.replace(/\/$/, ''),
  apiKey: local.apiKey,
};

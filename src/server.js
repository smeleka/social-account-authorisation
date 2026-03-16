import http from 'node:http';
import { config } from './config.js';
import { route } from './app.js';
import { json } from './lib/utils.js';

const server = http.createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    console.error(error);
    json(response, 500, {
      error: 'Internal server error',
      message: error.message,
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Listening on ${config.baseUrl} via ${config.host}:${config.port}`);
});

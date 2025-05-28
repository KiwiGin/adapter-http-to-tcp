const express = require('express');
const cors = require('cors');
const net = require('net');
const { promisify } = require('util');

class TCPConnectionPool {
  constructor() {
    this.connections = new Map();
  }

  async getConnection(host, port) {
    const key = `${host}:${port}`;
    
    if (this.connections.has(key)) {
      const conn = this.connections.get(key);
      if (!conn.destroyed) {
        return conn;
      }
      this.connections.delete(key);
    }

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port }, () => {
        this.connections.set(key, socket);
        resolve(socket);
      });
      
      socket.on('error', reject);
      socket.on('close', () => {
        this.connections.delete(key);
      });
    });
  }

  closeAll() {
    for (const [key, socket] of this.connections) {
      if (!socket.destroyed) {
        socket.destroy();
      }
    }
    this.connections.clear();
  }
}

class HTTPToTCPAdapter {
  constructor(options = {}) {
    this.app = express();
    this.app.use(cors());
    this.tcpPool = new TCPConnectionPool();
    this.timeout = options.timeout || 5000;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.text({ type: 'text/plain' }));
    this.app.use(express.text({ type: 'application/x-www-form-urlencoded' }));
    this.app.use(express.raw({ type: 'application/octet-stream' }));
    
    // Middleware de logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      console.log(`Body recibido:`, req.body);
      next();
    });
  }

  setupRoutes() {
    // Ruta principal para enviar comandos TCP
    this.app.post('/tcp/:host/:port', async (req, res) => {
      try {
        const { host, port } = req.params;
        
        // Manejar diferentes tipos de body
        let command;
        if (typeof req.body === 'string') {
          command = req.body;
        } else if (req.body && typeof req.body === 'object') {
          command = JSON.stringify(req.body);
        } else {
          command = String(req.body || '');
        }
        
        console.log(`Enviando comando TCP a ${host}:${port} - "${command}"`);
        
        const response = await this.sendTCPCommand(host, parseInt(port), command);
        
        res.json({
          success: true,
          response: response,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error en comando TCP:', error.message);
        res.status(500).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Ruta para comandos con configuración personalizada
    this.app.post('/command', async (req, res) => {
      try {
        const { host, port, command, options = {} } = req.body;
        
        if (!host || !port || !command) {
          return res.status(400).json({
            success: false,
            error: 'Faltan parámetros requeridos: host, port, command'
          });
        }

        console.log(`Enviando comando TCP a ${host}:${port} - "${command}"`);
        console.log('Opciones:', options);
        
        const response = await this.sendTCPCommand(host, port, command, options);
        
        res.json({
          success: true,
          response: response,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error en comando TCP:', error);
        console.error('Stack trace:', error.stack);
        res.status(500).json({
          success: false,
          error: error.message,
          code: error.code || 'UNKNOWN_ERROR',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Ruta de salud
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        connections: this.tcpPool.connections.size
      });
    });

    // Ruta para listar conexiones activas
    this.app.get('/connections', (req, res) => {
      const connections = Array.from(this.tcpPool.connections.keys());
      res.json({
        active_connections: connections,
        count: connections.length
      });
    });
  }

  async sendTCPCommand(host, port, command, options = {}) {
    const timeout = options.timeout || this.timeout;
    const encoding = options.encoding || 'utf8';
    const delimiter = options.delimiter || '\n';

    console.log(`Intentando conectar a ${host}:${port} con timeout ${timeout}ms`);

    return new Promise(async (resolve, reject) => {
      let socket;
      let timeoutId;
      let responseData = '';

      try {
        // Configurar timeout
        timeoutId = setTimeout(() => {
          console.log(`Timeout alcanzado (${timeout}ms) para ${host}:${port}`);
          if (socket && !socket.destroyed) {
            socket.destroy();
          }
          reject(new Error(`Timeout después de ${timeout}ms conectando a ${host}:${port}`));
        }, timeout);

        // Obtener conexión TCP
        console.log(`Obteniendo conexión TCP a ${host}:${port}...`);
        socket = await this.tcpPool.getConnection(host, port);
        console.log(`Conexión TCP establecida a ${host}:${port}`);

        // Configurar manejo de respuesta
        const onData = (data) => {
          console.log(`Datos recibidos de ${host}:${port}:`, data.toString());
          responseData += data.toString(encoding);
          
          // Si tenemos un delimitador, verificar si llegó la respuesta completa
          if (delimiter && responseData.includes(delimiter)) {
            console.log(`Delimitador encontrado, respuesta completa`);
            clearTimeout(timeoutId);
            socket.removeListener('data', onData);
            socket.removeListener('error', onError);
            resolve(responseData.trim());
          }
        };

        const onError = (error) => {
          console.error(`Error en socket TCP ${host}:${port}:`, error);
          clearTimeout(timeoutId);
          socket.removeListener('data', onData);
          reject(new Error(`Error TCP: ${error.message} (${error.code})`));
        };

        socket.on('data', onData);
        socket.on('error', onError);

        // Enviar comando
        const commandToSend = command + (delimiter || '');
        console.log(`Enviando comando: "${commandToSend}" a ${host}:${port}`);
        socket.write(commandToSend, encoding);

        // Si no hay delimitador, esperar un tiempo y devolver lo que llegó
        if (!delimiter) {
          console.log(`Sin delimitador, esperando respuesta por 1 segundo...`);
          setTimeout(() => {
            clearTimeout(timeoutId);
            socket.removeListener('data', onData);
            socket.removeListener('error', onError);
            console.log(`Respuesta sin delimitador: "${responseData}"`);
            resolve(responseData);
          }, Math.min(timeout, 1000));
        }

      } catch (error) {
        console.error(`Error en sendTCPCommand para ${host}:${port}:`, error);
        if (timeoutId) clearTimeout(timeoutId);
        reject(new Error(`Error conectando a ${host}:${port}: ${error.message} (${error.code})`));
      }
    });
  }

  start(port = 3001) {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        console.log(`[OK] Servidor adaptador HTTP-to-TCP ejecutándose en puerto ${port}`);
        console.log(`[OK] Endpoints disponibles:`);
        console.log(`   POST http://localhost:${port}/tcp/:host/:port - Enviar comando directo`);
        console.log(`   POST http://localhost:${port}/command - Enviar comando con opciones`);
        console.log(`   GET  http://localhost:${port}/health - Estado del servidor`);
        console.log(`   GET  http://localhost:${port}/connections - Conexiones activas`);
        resolve();
      });
    });
  }

  async stop() {
    if (this.server) {
      await promisify(this.server.close.bind(this.server))();
    }
    this.tcpPool.closeAll();
    console.log('[STOP] Servidor detenido');
  }
}

// Uso del adaptador
async function main() {
  const adapter = new HTTPToTCPAdapter({
    timeout: 5000
  });

  await adapter.start(3001);

  // Manejo graceful de cierre
  process.on('SIGINT', async () => {
    console.warn('\n Cerrando servidor...');
    await adapter.stop();
    process.exit(0);
  });
}

// Iniciar si se ejecuta directamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { HTTPToTCPAdapter };
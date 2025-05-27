// test-client.js - Cliente de prueba para el adaptador
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testAdapter() {
  console.log('Adapter HTTP-to-TCP\n');

  try {
    // 1. Verificar estado del servidor
    console.log('1. Verificando estado del servidor');
    const health = await axios.get(`${BASE_URL}/health`);
    console.log('[OK] Servidor:', health.data);
    console.log();

    // 2. Ejemplo: Comando directo por URL
    console.log('2. Enviando comando directo');
    try {
      const response1 = await axios.post(
        `${BASE_URL}/tcp/localhost/8080`, 
        'GET_STATUS'
      );
      console.log('[OK] Respuesta:', response1.data);
    } catch (error) {
      console.error('Error esperado (no hay servidor TCP en localhost:8080):', error.response?.data?.error);
    }
    console.log();

    // 3. Ejemplo: Comando con opciones personalizadas
    console.log('3. Enviando comando con opciones personalizadas');
    try {
      const response2 = await axios.post(`${BASE_URL}/command`, {
        host: 'localhost',
        port: 8080,
        command: 'HELLO_WORLD',
        options: {
          timeout: 3000,
          delimiter: '\r\n',
          encoding: 'utf8'
        }
      });
      console.log('[OK] Respuesta:', response2.data);
    } catch (error) {
      console.error('Error esperado (no hay servidor TCP):', error.response?.data?.error);
    }
    console.log();

    // 4. Verificar conexiones activas
    console.log('4. Verificando conexiones activas');
    const connections = await axios.get(`${BASE_URL}/connections`);
    console.log('[OK] Conexiones:', connections.data);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Función para crear un servidor TCP de prueba
function createTestTCPServer(port = 8080) {
  const net = require('net');
  
  const server = net.createServer((socket) => {
    console.log(`[Cliente TCP conectado desde ${socket.remoteAddress}:${socket.remotePort}]`);
    
    socket.on('data', (data) => {
      const command = data.toString().trim();
      console.log(`[Comando recibido]: "${command}"`);
      
      // Simular respuestas según el comando
      let response;
      switch (command) {
        case 'GET_STATUS':
          response = 'STATUS_OK\n';
          break;
        case 'HELLO_WORLD':
          response = 'HELLO_RESPONSE\r\n';
          break;
        case 'GET_TIME':
          response = new Date().toISOString() + '\n';
          break;
        default:
          response = `Wa: ${command}\n`;
      }
      
      socket.write(response);
    });
    
    socket.on('close', () => {
      console.warn('[Cliente TCP desconectado]');
    });
    
    socket.on('error', (err) => {
      console.error('[Error en socket TCP]:', err.message);
    });
  });
  
  server.listen(port, () => {
    console.log(`[OK] Servidor TCP de prueba ejecutándose en puerto ${port}`);
  });
  
  return server;
}

// Ejemplos de uso con curl
function showCurlExamples() {
  console.log('\nEjemplos con curl:');
  console.log('');
  console.log('# Comando directo:');
  console.log('curl -X POST http://localhost:3000/tcp/localhost/8080 \\');
  console.log('     -H "Content-Type: text/plain" \\');
  console.log('     -d "GET_STATUS"');
  console.log('');
  console.log('# Comando con opciones:');
  console.log('curl -X POST http://localhost:3000/command \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"host":"localhost","port":8080,"command":"GET_TIME","options":{"timeout":2000}}\'');
  console.log('');
  console.log('# Estado del servidor:');
  console.log('curl http://localhost:3000/health');
  console.log('');
}

// Función principal
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--server')) {
    // Crear servidor TCP de prueba
    console.log('[OK] Iniciando servidor TCP de prueba');
    const port = parseInt(args[args.indexOf('--server') + 1]) || 8080;
    createTestTCPServer(port);
    
    // Mantener el servidor corriendo
    process.on('SIGINT', () => {
      console.log('\n[STOP] Cerrando servidor TCP de prueba');
      process.exit(0);
    });
    
  } else if (args.includes('--examples')) {
    showCurlExamples();
    
  } else {
    // Ejecutar pruebas
    await testAdapter();
    showCurlExamples();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testAdapter, createTestTCPServer };
// P2P 네트워크 중계 서버 (Railway 클라우드용)
// 풀노드들을 등록하고 관리하며, 사용자 요청을 적절한 풀노드로 라우팅

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

// 중계서버 고유 ID
const nodeId = uuidv4();

const app = express();
const port = process.env.PORT || 3000;
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 중계서버 설정
const RELAY_PASSWORD = process.env.RELAY_PASSWORD || 'default-password';
const RELAY_LOCATION = process.env.RELAY_LOCATION || '37.5665,126.9780'; // 서울 기본값

let isAuthenticated = false;
let connectedValidator = null;
let tunnelConnection = null; // WebSocket 터널 연결

// 등록된 풀노드들 관리
const registeredNodes = new Map(); // nodeId -> { ws, info, lastPing }
const userSessions = new Map(); // sessionId -> { nodeId, ws, userDID }
const usersByDID = new Map(); // userDID -> Set of sessionIds
const pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }

// CORS 설정 - 간단하게 모든 도메인 허용 (credentials 없이)
app.use(cors({
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-UUID']
}));
app.use(express.json());

// 중계서버 인증 API
app.post('/api/auth', (req, res) => {
  const { password, nodeType, nodeId, endpoint } = req.body;
  
  if (!password) {
    return res.status(400).json({
      success: false,
      error: '비밀번호가 필요합니다'
    });
  }
  
  if (password !== RELAY_PASSWORD) {
    return res.status(401).json({
      success: false,
      error: '잘못된 비밀번호입니다'
    });
  }
  
  isAuthenticated = true;
  
  if (nodeType === 'validator' && nodeId && endpoint) {
    // 기존 WebSocket 터널 연결이 있으면 유지하고 정보만 업데이트
    if (connectedValidator && connectedValidator.type === 'websocket-tunnel') {
      console.log(`✅ 기존 WebSocket 터널 유지 - 검증자 노드 정보 업데이트: ${nodeId}`);
      connectedValidator.nodeId = nodeId;
      connectedValidator.endpoint = endpoint;
    } else {
      // 새로운 HTTP 기반 연결
      connectedValidator = {
        type: 'http',
        nodeId: nodeId,
        endpoint: endpoint,
        connectedAt: Date.now()
      };
      console.log(`✅ 검증자 노드 인증 성공 (HTTP): ${nodeId} (${endpoint})`);
    }
    
    // 리스팅 서버에 등록
    registerToListingServer();
  }
  
  res.json({
    success: true,
    message: '인증 성공',
    relayInfo: {
      location: RELAY_LOCATION,
      connectedAt: Date.now()
    }
  });
});

// 리스팅 서버 자동 탐색 함수
async function discoverListingServer() {
  console.log('🔍 리스팅 서버 자동 탐색 중...');
  
  // Fly.io와 Railway를 번갈아가며 시도
  for (let i = 1; i <= 50; i++) { // 최대 50개까지 탐색
    // Fly.io 시도
    const flyUrl = `https://bplisting${i}.fly.dev`;
    
    try {
      console.log(`   시도 중: ${flyUrl}`);
      const response = await fetch(`${flyUrl}/api/status`, {
        method: 'GET',
        timeout: 3000
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'running') {
          console.log(`✅ 리스팅 서버 발견: ${flyUrl}`);
          return flyUrl;
        }
      }
    } catch (error) {
      // 조용히 실패 - Railway 시도로 계속
    }
    
    // Railway 시도
    const railwayUrl = `https://bplisting${i}-production.up.railway.app`;
    
    try {
      console.log(`   시도 중: ${railwayUrl}`);
      const response = await fetch(`${railwayUrl}/api/status`, {
        method: 'GET',
        timeout: 3000
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'running') {
          console.log(`✅ 리스팅 서버 발견: ${railwayUrl}`);
          return railwayUrl;
        }
      }
    } catch (error) {
      // 조용히 실패 - 다음 번호로 계속
    }
  }
  
  console.log('❌ 사용 가능한 리스팅 서버를 찾지 못했습니다.');
  return null;
}

// 리스팅 서버에 중계서버 등록
async function registerToListingServer() {
  // 먼저 자동 탐색으로 리스팅 서버 찾기
  const discoveredServer = await discoverListingServer();
  
  const listingServers = [];
  if (discoveredServer) {
    listingServers.push(discoveredServer);
  }
  
  // 백업 서버들 추가 (배포 환경 전용)
  listingServers.push(
    'https://bplisting.fly.dev'
  );
  
  // 중계서버 URL 동적 감지 (로컬 개발 환경 제외)
  let relayUrl = null;
  
  // 환경변수에서 직접 지정된 경우
  if (process.env.RELAY_SERVER_URL) {
    relayUrl = process.env.RELAY_SERVER_URL;
  }
  // Railway 환경 감지
  else if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    relayUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  // Fly.io 환경 감지
  else if (process.env.FLY_APP_NAME) {
    relayUrl = `https://${process.env.FLY_APP_NAME}.fly.dev`;
  }
  // Fly.io 환경에서 app 이름이 설정되지 않은 경우
  else if (process.env.FLY_ALLOC_ID || process.env.FLY_REGION) {
    relayUrl = `https://bprelay.fly.dev`; // 기본 Fly.io URL
  }
  // Railway 환경에서 도메인이 설정되지 않은 경우
  else if (process.env.RAILWAY_ENVIRONMENT) {
    relayUrl = `https://bprelay1-production.up.railway.app`; // 기본 Railway URL
  }
  
  // 배포 환경이 아니면 등록하지 않음
  if (!relayUrl) {
    console.log('🏠 로컬 개발 환경: 리스팅 서버 등록 생략');
    return;
  }
  
  console.log(`🌐 중계서버 URL: ${relayUrl}`);
  
  for (const listingServer of listingServers) {
    try {
      const response = await fetch(`${listingServer}/api/register-relay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: relayUrl,
          location: RELAY_LOCATION,
          nodeInfo: {
            relayId: uuidv4(),
            connectedValidator: connectedValidator,
            capabilities: ['block_propagation', 'transaction_relay'],
            version: '1.0.0'
          },
          timestamp: Date.now()
        }),
        timeout: 5000
      });
      
      if (response.ok) {
        console.log(`✅ 리스팅 서버 등록 성공: ${listingServer}`);
        break;
      }
    } catch (error) {
      console.log(`❌ 리스팅 서버 등록 실패: ${listingServer} (${error.message})`);
    }
  }
}

// 리스팅 서버에서 중계서버 제거
async function removeFromListingServer() {
  // 먼저 자동 탐색으로 리스팅 서버 찾기
  const discoveredServer = await discoverListingServer();
  
  const listingServers = [];
  if (discoveredServer) {
    listingServers.push(discoveredServer);
  }
  
  // 백업 서버들 추가 (배포 환경 전용)
  listingServers.push(
    'https://bplisting.fly.dev'
  );
  
  // 중계서버 URL 동적 감지
  let relayUrl = null;
  
  if (process.env.RELAY_SERVER_URL) {
    relayUrl = process.env.RELAY_SERVER_URL;
  } else if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    relayUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  } else if (process.env.FLY_APP_NAME) {
    const flyRegion = process.env.FLY_REGION || '';
    const flyAllocId = process.env.FLY_ALLOC_ID || '';
    if (flyRegion && flyAllocId) {
      relayUrl = `https://${process.env.FLY_APP_NAME}.fly.dev`;
    }
  }
  
  if (!relayUrl) {
    console.log('⚠️ 중계서버 URL을 감지할 수 없어 리스팅서버에서 제거할 수 없습니다');
    return;
  }
  
  for (const listingServer of listingServers) {
    try {
      const response = await fetch(`${listingServer}/api/remove-relay`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: relayUrl
        }),
        timeout: 5000
      });
      
      if (response.ok) {
        console.log(`✅ 리스팅 서버에서 제거 성공: ${listingServer} (URL: ${relayUrl})`);
        break;
      }
    } catch (error) {
      console.log(`❌ 리스팅 서버 제거 실패: ${listingServer} (${error.message})`);
    }
  }
}

// 핑 API (웹앱 최적화용)
app.get('/api/ping', (req, res) => {
  res.json({
    success: true,
    timestamp: Date.now(),
    status: 'online'
  });
});

// 검증자로 요청 전달하는 함수
async function forwardToValidator(validator, requestData) {
  try {
    const { method, path, body, query, headers } = requestData;
    
    console.log(`🔍 검증자 타입: ${validator.type}, WebSocket 상태: ${validator.ws ? 'OK' : 'NULL'}`);
    
    if (validator.type === 'websocket-tunnel' && validator.ws) {
      // WebSocket 터널을 통한 요청 전달
      console.log(`📡 WebSocket 터널을 통한 요청 전달: ${method} ${path}`);
      return await forwardThroughTunnel(validator.ws, requestData);
    } else {
      // 기존 HTTP 직접 요청 (폴백)
      console.log(`📡 HTTP 직접 요청 전달: ${method} ${path} → ${validator.endpoint}`);
      const validatorUrl = validator.endpoint;
      
      // 쿼리 파라미터 구성
      const queryString = query && Object.keys(query).length > 0 
        ? '?' + new URLSearchParams(query).toString() 
        : '';
      
      const response = await fetch(`${validatorUrl}/api${path}${queryString}`, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-From': 'relay-server'
        },
        body: method !== 'GET' && body ? JSON.stringify(body) : undefined,
        timeout: 10000
      });
      
      const data = await response.json();
      
      return {
        status: response.status,
        data: data
      };
    }
  } catch (error) {
    console.error('❌ 검증자 요청 전달 실패:', error.message);
    return {
      status: 500,
      data: {
        success: false,
        error: '검증자 연결 실패',
        details: error.message
      }
    };
  }
}

// WebSocket 터널을 통한 HTTP 요청 전달
async function forwardThroughTunnel(tunnelWs, requestData) {
  return new Promise((resolve, reject) => {
    const requestId = uuidv4();
    const { method, path, body, query, headers } = requestData;
    
    // 요청 타임아웃 설정 (45초로 연장)
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('터널 요청 타임아웃'));
    }, 45000);
    
    // 대기 중인 요청에 등록
    pendingRequests.set(requestId, { 
      resolve: (data) => {
        clearTimeout(timeout);
        resolve({
          status: data.status || 200,
          data: data.body || data
        });
      }, 
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      }, 
      timeout 
    });
    
    // WebSocket을 통해 HTTP 요청 전달
    const tunnelMessage = {
      type: 'http_request',
      requestId: requestId,
      method: method,
      path: `/api${path}`,
      query: query,
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-From': 'relay-server',
        ...headers
      },
      body: body
    };
    
    try {
      tunnelWs.send(JSON.stringify(tunnelMessage));
      console.log(`📡 터널로 요청 전달: ${method} ${path} (${requestId})`);
    } catch (error) {
      clearTimeout(timeout);
      pendingRequests.delete(requestId);
      reject(error);
    }
  });
}

// 중계서버 리스트 업데이트 수신 API
app.post('/api/relay-list-update', (req, res) => {
  const { type, relays, timestamp, source } = req.body;
  
  if (type === 'relay_list_update') {
    console.log(`📡 리스트 업데이트 수신: ${relays.length}개 중계서버 (from: ${source})`);
    
    // 리스트 정보를 메모리에 저장
    global.relayList = relays;
    global.lastListUpdate = timestamp;
    
    // 연결된 모든 풀노드들에게 업데이트된 중계서버 리스트 전파
    broadcastToNodes({
      type: 'relay_list_update',
      relays: relays,
      timestamp: timestamp,
      source: source
    });
    
    console.log(`📤 ${relays.length}개 중계서버 리스트를 연결된 풀노드들에게 전파`);
  }
  
  res.json({
    success: true,
    message: '리스트 업데이트 수신 완료'
  });
});

// 블록 전파 수신 API
app.post('/api/block-propagation', (req, res) => {
  const { type, block, validatorDID, timestamp } = req.body;
  
  if (type === 'block_propagation' && block) {
    console.log(`📦 블록 #${block.index} 전파 수신 (검증자: ${validatorDID?.substring(0, 8)}...)`);
    
    // 연결된 모든 WebSocket 클라이언트들에게 블록 전파
    const blockMessage = {
      type: 'new_block_received',
      block: block,
      source: 'external',
      sourceRelayId: nodeId,
      originalValidatorDID: validatorDID,
      timestamp: timestamp
    };
    
    let connectedCount = 0;
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify(blockMessage));
          connectedCount++;
        } catch (error) {
          console.warn('⚠️ 블록 전파 실패:', error.message);
        }
      }
    });
    
    console.log(`📤 블록 #${block.index}을 연결된 ${connectedCount}개 WebSocket 클라이언트에 전파`);
  }
  
  res.json({
    success: true,
    message: '블록 전파 완료'
  });
});

// 클라이언트들에게 메시지 브로드캐스트
function broadcastToClients(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        console.warn('⚠️ 클라이언트 브로드캐스트 실패:', error.message);
      }
    }
  });
}

// 중계 서버 상태 확인 (Healthcheck용 - 항상 200 응답)
app.get('/api/relay-status', (req, res) => {
  const onlineNodes = Array.from(registeredNodes.values())
    .filter(node => Date.now() - node.lastPing < 30000);
  
  res.status(200).json({
    success: true,
    relayServer: {
      status: 'online',
      uptime: process.uptime(),
      version: '1.0.0'
    },
    network: {
      totalNodes: registeredNodes.size,
      onlineNodes: onlineNodes.length,
      offlineNodes: registeredNodes.size - onlineNodes.length
    },
    connections: {
      totalSessions: userSessions.size,
      activeConnections: wss.clients.size
    },
    isReady: onlineNodes.length > 0 // 노드 연결 상태만 표시
  });
});

// 풀노드 등록 상태 확인
app.get('/api/nodes', (req, res) => {
  const nodes = Array.from(registeredNodes.values()).map(node => ({
    id: node.info.id,
    endpoint: node.info.endpoint,
    lastPing: node.lastPing,
    status: Date.now() - node.lastPing < 30000 ? 'online' : 'offline'
  }));
  
  res.json({
    success: true,
    nodes: nodes,
    totalNodes: nodes.length,
    onlineNodes: nodes.filter(n => n.status === 'online').length
  });
});

// 사용자 API를 풀노드로 라우팅 (와일드카드는 맨 마지막에)
app.all('/api/*', async (req, res) => {
  try {
    // 먼저 연결된 검증자(풀노드) 확인
    if (!connectedValidator) {
      return res.status(503).json({
        success: false,
        error: '연결된 풀노드가 없습니다',
        code: 'NO_VALIDATOR_CONNECTED'
      });
    }
    
    // 검증자 연결 상태 확인 (5분 이내)
    if (Date.now() - connectedValidator.connectedAt > 300000) {
      connectedValidator = null;
      return res.status(503).json({
        success: false,
        error: '풀노드 연결이 만료되었습니다',
        code: 'VALIDATOR_CONNECTION_EXPIRED'
      });
    }
    
    // 연결된 풀노드로 요청 전달
    const apiPath = req.path.replace('/api', '');
    console.log(`📡 풀노드로 요청 전달: ${req.method} ${apiPath} → ${connectedValidator.endpoint}`);
    
    const nodeResponse = await forwardToValidator(connectedValidator, {
      method: req.method,
      path: apiPath,
      headers: req.headers,
      body: req.body,
      query: req.query
    });
    
    // 응답 전달
    const statusCode = nodeResponse.status || 200;
    const responseData = nodeResponse.data || nodeResponse;
    res.status(statusCode).json(responseData);
    
  } catch (error) {
    console.error('API 라우팅 오류:', error);
    res.status(500).json({
      success: false,
      error: '중계 서버 오류',
      details: error.message
    });
  }
});

// WebSocket 연결 처리
wss.on('connection', (ws, req) => {
  const connectionId = uuidv4();
  let connectionType = null; // 'node', 'user', 또는 'tunnel'
  let nodeId = null;
  let sessionId = null;
  
  console.log(`🔌 새로운 WebSocket 연결: ${connectionId}`);
  
  // URL 경로로 터널 연결인지 확인
  if (req.url === '/tunnel') {
    connectionType = 'tunnel';
    tunnelConnection = ws;
    console.log('🔄 WebSocket 터널 연결 설정됨');
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        if (data.type === 'tunnel_auth') {
          // 터널 인증
          if (data.password === RELAY_PASSWORD) {
            connectedValidator = {
              type: 'websocket-tunnel',
              ws: ws,
              nodeId: data.nodeId,
              endpoint: data.endpoint
            };
            
            ws.send(JSON.stringify({
              type: 'tunnel_auth_response',
              success: true,
              message: '터널 인증 성공'
            }));
            
            console.log(`✅ WebSocket 터널 인증 성공: ${data.nodeId}`);
          } else {
            ws.send(JSON.stringify({
              type: 'tunnel_auth_response',
              success: false,
              message: '터널 인증 실패'
            }));
            ws.close();
          }
        } else if (data.type === 'http_response') {
          // HTTP 응답을 대기 중인 요청에 전달
          if (pendingRequests.has(data.requestId)) {
            const { resolve } = pendingRequests.get(data.requestId);
            pendingRequests.delete(data.requestId);
            resolve(data);
          }
        }
      } catch (error) {
        console.error('❌ 터널 메시지 파싱 오류:', error);
      }
    });
    
    ws.on('close', () => {
      console.log('🔌 WebSocket 터널 연결 종료');
      tunnelConnection = null;
      connectedValidator = null;
      
      // 터널 연결이 해제되면 리스팅서버에서 이 중계서버 삭제 요청
      console.log('⚠️ 터널 연결 해제됨 - 리스팅서버에서 중계서버 제거 요청');
      removeFromListingServer();
    });
    
    return; // 일반 WebSocket 로직으로 진행하지 않음
  }
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'register_node':
          // 풀노드 등록
          connectionType = 'node';
          nodeId = data.nodeId || uuidv4();
          
          registeredNodes.set(nodeId, {
            ws: ws,
            info: {
              id: nodeId,
              endpoint: data.endpoint,
              version: data.version,
              capabilities: data.capabilities || []
            },
            lastPing: Date.now()
          });
          
          console.log(`🟢 풀노드 등록됨: ${nodeId}`);
          
          ws.send(JSON.stringify({
            type: 'node_registered',
            nodeId: nodeId,
            success: true
          }));
          
          // 다른 노드들에게 새 노드 알림
          broadcastToNodes({
            type: 'node_joined',
            nodeId: nodeId,
            nodeInfo: registeredNodes.get(nodeId).info
          }, nodeId);
          
          break;
          
        case 'user_connect':
          // 사용자 연결
          connectionType = 'user';
          sessionId = data.sessionId || uuidv4();
          const userDID = data.did; // 사용자 DID 저장
          
          // 이중 접속 방지: 기존 세션이 있으면 종료
          if (userDID && usersByDID.has(userDID)) {
            const existingSessions = usersByDID.get(userDID);
            
            // 기존 세션들에게 종료 메시지 전송
            existingSessions.forEach(existingSessionId => {
              const existingSession = userSessions.get(existingSessionId);
              if (existingSession && existingSession.ws.readyState === WebSocket.OPEN) {
                existingSession.ws.send(JSON.stringify({
                  type: 'session_terminated',
                  reason: '다른 기기에서 로그인했습니다.',
                  newSession: sessionId
                }));
                existingSession.ws.close();
              }
              
              // 기존 세션 정리
              userSessions.delete(existingSessionId);
            });
            
            // 기존 DID 매핑 정리
            usersByDID.delete(userDID);
            
            console.log(`🔄 이중 접속 방지: ${userDID?.substring(0, 8)}... 기존 세션 ${existingSessions.size}개 종료`);
          }
          
          // 사용 가능한 노드 찾기
          const availableNodes = Array.from(registeredNodes.keys())
            .filter(id => Date.now() - registeredNodes.get(id).lastPing < 30000);
          
          if (availableNodes.length > 0) {
            const assignedNodeId = availableNodes[Math.floor(Math.random() * availableNodes.length)];
            
            userSessions.set(sessionId, {
              nodeId: assignedNodeId,
              ws: ws,
              userDID: userDID
            });
            
            // DID별 세션 추적
            if (userDID) {
              if (!usersByDID.has(userDID)) {
                usersByDID.set(userDID, new Set());
              }
              usersByDID.get(userDID).add(sessionId);
            }
            
            ws.send(JSON.stringify({
              type: 'user_connected',
              sessionId: sessionId,
              assignedNode: assignedNodeId,
              success: true
            }));
            
            console.log(`👤 사용자 연결됨: ${sessionId} (DID: ${userDID?.substring(0, 8)}...) -> 노드 ${assignedNodeId}`);
          } else {
            ws.send(JSON.stringify({
              type: 'user_connect_failed',
              error: '사용 가능한 노드가 없습니다'
            }));
          }
          
          break;
          
        case 'node_ping':
          // 노드 상태 업데이트
          if (nodeId && registeredNodes.has(nodeId)) {
            registeredNodes.get(nodeId).lastPing = Date.now();
            
            ws.send(JSON.stringify({
              type: 'pong',
              timestamp: Date.now()
            }));
          }
          break;
          
        case 'user_request':
          // 사용자 요청을 노드로 전달
          if (sessionId && userSessions.has(sessionId)) {
            const session = userSessions.get(sessionId);
            const targetNode = registeredNodes.get(session.nodeId);
            
            if (targetNode && targetNode.ws.readyState === WebSocket.OPEN) {
              targetNode.ws.send(JSON.stringify({
                type: 'user_request',
                sessionId: sessionId,
                request: data.request
              }));
            }
          }
          break;
          
        case 'node_response':
          // 노드 응답을 사용자에게 전달
          if (data.sessionId && userSessions.has(data.sessionId)) {
            const session = userSessions.get(data.sessionId);
            
            if (session.ws.readyState === WebSocket.OPEN) {
              session.ws.send(JSON.stringify({
                type: 'node_response',
                response: data.response
              }));
            }
          }
          break;
          
        case 'state_update':
          // 풀노드에서 보낸 실시간 상태 업데이트를 해당 사용자에게 전달
          if (data.userDID) {
            broadcastToUser(data.userDID, {
              type: 'state_update',
              ...data.updateData
            });
            console.log(`📤 상태 업데이트 전달: ${data.userDID} -> ${JSON.stringify(data.updateData).substring(0, 100)}...`);
          }
          break;
          
        case 'pool_update':
          // 검증자 풀 업데이트를 모든 사용자에게 브로드캐스트
          broadcastToAllUsers({
            type: 'pool_update',
            validatorPool: data.validatorPool
          });
          console.log(`📤 검증자 풀 업데이트 전달: ${JSON.stringify(data.validatorPool)}`);
          break;
          
        case 'dao_treasury_update':
          // DAO 금고 업데이트를 모든 사용자에게 브로드캐스트
          broadcastToAllUsers({
            type: 'dao_treasury_update',
            daoTreasuries: data.daoTreasuries
          });
          console.log(`📤 DAO 금고 업데이트 전달: ${JSON.stringify(data.daoTreasuries)}`);
          break;
      }
    } catch (error) {
      console.error('WebSocket 메시지 처리 오류:', error);
    }
  });
  
  ws.on('close', () => {
    console.log(`🔌 WebSocket 연결 종료: ${connectionId}`);
    
    if (connectionType === 'node' && nodeId) {
      registeredNodes.delete(nodeId);
      console.log(`🔴 풀노드 해제됨: ${nodeId}`);
      
      // 다른 노드들에게 노드 이탈 알림
      broadcastToNodes({
        type: 'node_left',
        nodeId: nodeId
      }, nodeId);
      
      // 모든 풀노드가 연결 해제되면 리스팅서버에서 이 중계서버 삭제 요청
      if (registeredNodes.size === 0) {
        console.log('⚠️ 모든 풀노드 연결 해제됨 - 리스팅서버에서 중계서버 제거 요청');
        removeFromListingServer();
      }
      
    } else if (connectionType === 'user' && sessionId) {
      const session = userSessions.get(sessionId);
      
      // DID별 세션 추적에서 제거
      if (session && session.userDID) {
        const userSessions = usersByDID.get(session.userDID);
        if (userSessions) {
          userSessions.delete(sessionId);
          if (userSessions.size === 0) {
            usersByDID.delete(session.userDID);
          }
        }
      }
      
      userSessions.delete(sessionId);
      console.log(`👤 사용자 연결 종료: ${sessionId} (DID: ${session?.userDID?.substring(0, 8)}...)`);
    }
  });
});

// 노드들에게 메시지 브로드캐스트
function broadcastToNodes(message, excludeNodeId = null) {
  registeredNodes.forEach((node, nodeId) => {
    if (nodeId !== excludeNodeId && node.ws.readyState === WebSocket.OPEN) {
      node.ws.send(JSON.stringify(message));
    }
  });
}

// 특정 사용자에게 메시지 전달
function broadcastToUser(userDID, message) {
  const sessionIds = usersByDID.get(userDID);
  if (sessionIds) {
    sessionIds.forEach(sessionId => {
      const session = userSessions.get(sessionId);
      if (session && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify(message));
      }
    });
  }
}

// 모든 사용자에게 메시지 브로드캐스트
function broadcastToAllUsers(message) {
  userSessions.forEach((session, sessionId) => {
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify(message));
    }
  });
}

// 풀노드에게 HTTP 요청 전달
async function forwardToNode(node, request) {
  return new Promise((resolve, reject) => {
    const requestId = uuidv4();
    const timeout = setTimeout(() => {
      reject(new Error('Node request timeout'));
    }, 10000);
    
    // 응답 대기
    const responseHandler = (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'http_response' && data.requestId === requestId) {
          clearTimeout(timeout);
          node.ws.removeListener('message', responseHandler);
          resolve(data.response);
        }
      } catch (error) {
        // 다른 메시지 무시
      }
    };
    
    node.ws.on('message', responseHandler);
    
    // 요청 전달
    node.ws.send(JSON.stringify({
      type: 'http_request',
      requestId: requestId,
      request: request
    }));
  });
}

// 오프라인 노드 정리 (5분마다)
setInterval(() => {
  const now = Date.now();
  const offlineNodes = [];
  
  registeredNodes.forEach((node, nodeId) => {
    if (now - node.lastPing > 300000) { // 5분 이상 무응답
      offlineNodes.push(nodeId);
    }
  });
  
  offlineNodes.forEach(nodeId => {
    registeredNodes.delete(nodeId);
    console.log(`🧹 오프라인 노드 정리: ${nodeId}`);
  });
  
  if (offlineNodes.length > 0) {
    broadcastToNodes({
      type: 'nodes_cleanup',
      removedNodes: offlineNodes
    });
  }
}, 300000);

// WebSocket 터널 엔드포인트 추가
app.get('/tunnel', (req, res) => {
  // WebSocket 터널 업그레이드 요청 처리
  if (req.headers.upgrade === 'websocket') {
    console.log('🔄 WebSocket 터널 업그레이드 요청');
  } else {
    res.status(400).json({ error: 'WebSocket upgrade required' });
  }
});

// 서버 시작
server.listen(port, () => {
  console.log('🚀 백야 프로토콜 P2P 네트워크 중계 서버 시작');
  console.log(`🌐 포트: ${port}`);
  console.log(`🔗 풀노드 등록: ws://localhost:${port}/`);
  console.log(`🔗 사용자 API: http://localhost:${port}/api/`);
  console.log(`📊 네트워크 상태: http://localhost:${port}/api/relay-status`);
  console.log(`📊 등록된 노드 확인: http://localhost:${port}/api/nodes`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔄 풀노드 연결을 기다리는 중...');
  
  // 주기적으로 중계 서버 상태 출력 (30초마다)
  setInterval(() => {
    const onlineNodes = Array.from(registeredNodes.values())
      .filter(node => Date.now() - node.lastPing < 30000);
    
    console.log(`\n📊 [중계 서버 상태] ${new Date().toLocaleTimeString()}`);
    console.log(`   • 등록된 노드: ${registeredNodes.size}개`);
    console.log(`   • 온라인 노드: ${onlineNodes.length}개`);
    console.log(`   • 활성 세션: ${userSessions.size}개`);
    console.log(`   • WebSocket 연결: ${wss.clients.size}개`);
    
    // 연결된 검증자(풀노드) 상태 표시
    if (connectedValidator) {
      console.log(`   ✅ 검증자 연결됨: ${connectedValidator.nodeId} (${connectedValidator.endpoint})`);
    } else {
      console.log(`   ⚠️ 연결된 검증자가 없습니다`);
    }
    
    if (onlineNodes.length > 0) {
      console.log(`   • WebSocket 노드 목록:`);
      onlineNodes.forEach(node => {
        console.log(`     - ${node.info.id} (${node.info.endpoint})`);
      });
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }, 30000);
});

module.exports = app; 
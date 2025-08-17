const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const port = process.env.PORT || 4000;

// 미들웨어 설정
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 데이터 저장 파일
const DATA_FILE = path.join(__dirname, 'relay-listing-data.json');

// 메모리 데이터 구조
let relayServers = new Map(); // url -> { url, location, nodeInfo, lastUpdate, registeredAt }
let listingServers = new Map(); // url -> { url, lastUpdate, registeredAt, status }

// 서버 URL 동적 감지
function detectServerURL() {
  // 환경변수에서 직접 지정된 경우
  if (process.env.LISTING_SERVER_URL) {
    return process.env.LISTING_SERVER_URL;
  }
  
  // Railway 환경 감지
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  
  // Fly.io 환경 감지 (여러 방법 시도)
  if (process.env.FLY_APP_NAME) {
    return `https://${process.env.FLY_APP_NAME}.fly.dev`;
  }
  
  // Fly.io 환경에서 app 이름이 설정되지 않은 경우 기본값 사용
  if (process.env.FLY_ALLOC_ID || process.env.FLY_REGION) {
    return `https://bplisting.fly.dev`; // 기본 Fly.io URL
  }
  
  // Railway 환경에서 도메인이 설정되지 않은 경우
  if (process.env.RAILWAY_ENVIRONMENT) {
    return `https://bplisting1-production.up.railway.app`; // 기본 Railway URL
  }
  
  // 포트 기반 환경 추측
  const port = process.env.PORT || 4000;
  if (port == 8080) {
    // Railway는 보통 8080 포트
    return `https://bplisting1-production.up.railway.app`;
  } else if (port == 4000) {
    // Fly.io는 보통 4000 포트
    return `https://bplisting.fly.dev`;
  }
  
  // 개발 환경
  return `http://localhost:${port}`;
}

const CURRENT_SERVER_URL = detectServerURL();

// 로컬 주소 감지 함수
function isLocalUrl(url) {
  if (!url || typeof url !== 'string') return false;
  
  const localPatterns = [
    /^https?:\/\/localhost/i,
    /^https?:\/\/127\.0\.0\.1/i,
    /^https?:\/\/0\.0\.0\.0/i,
    /^https?:\/\/192\.168\./i,
    /^https?:\/\/10\./i,
    /^https?:\/\/172\.(1[6-9]|2[0-9]|3[01])\./i
  ];
  
  return localPatterns.some(pattern => pattern.test(url));
}

// 데이터 로드
async function loadData() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(data);
    relayServers = new Map(Object.entries(parsed.relayServers || {}));
    listingServers = new Map(Object.entries(parsed.listingServers || {}));
    console.log(`📊 ${relayServers.size}개 중계서버, ${listingServers.size}개 리스팅서버 데이터 로드 완료`);
  } catch (error) {
    console.log('📝 새 데이터 파일 생성');
    await saveData();
  }
}

// 데이터 저장
async function saveData() {
  try {
    const data = {
      relayServers: Object.fromEntries(relayServers),
      listingServers: Object.fromEntries(listingServers),
      lastUpdated: Date.now()
    };
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ 데이터 저장 실패:', error.message);
  }
}

// 중계서버 등록 API
app.post('/api/register-relay', async (req, res) => {
  try {
    const { url, location, nodeInfo, timestamp } = req.body;
    
    if (!url || !location) {
      return res.status(400).json({
        success: false,
        error: '중계서버 URL과 위치 정보가 필요합니다'
      });
    }
    
    // 로컬 주소 거부
    if (isLocalUrl(url)) {
      console.log(`🚫 로컬 주소 등록 거부: ${url}`);
      return res.status(400).json({
        success: false,
        error: '로컬 주소는 등록할 수 없습니다'
      });
    }
    
    // 중계서버 등록/업데이트
    const existingRelay = relayServers.get(url);
    const relayData = {
      url: url,
      location: location,
      nodeInfo: nodeInfo || {},
      lastUpdate: Date.now(),
      registeredAt: existingRelay ? existingRelay.registeredAt : Date.now()
    };
    
    relayServers.set(url, relayData);
    await saveData();
    
    console.log(`📡 중계서버 등록: ${url} (위치: ${location})`);
    
    // 모든 중계서버에 리스트 업데이트 전파
    await propagateListToAllRelays();
    
    // 다른 리스팅서버들에게도 업데이트 전파
    await propagateToListingServers('relay_update', { relayData });
    
    res.json({
      success: true,
      message: '중계서버가 등록되었습니다',
      totalRelays: relayServers.size,
      relayData: relayData
    });
    
  } catch (error) {
    console.error('❌ 중계서버 등록 실패:', error.message);
    res.status(500).json({
      success: false,
      error: '중계서버 등록 중 오류가 발생했습니다'
    });
  }
});

// 리스팅 서버 등록 API
app.post('/api/register-listing', async (req, res) => {
  try {
    const { url, nodeInfo, timestamp } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: '리스팅 서버 URL이 필요합니다'
      });
    }
    
    // 자기 자신 등록 방지
    if (url === CURRENT_SERVER_URL) {
      return res.status(400).json({
        success: false,
        error: '자기 자신은 등록할 수 없습니다'
      });
    }
    
    // 로컬 주소 거부
    if (isLocalUrl(url)) {
      console.log(`🚫 로컬 주소 리스팅서버 등록 거부: ${url}`);
      return res.status(400).json({
        success: false,
        error: '로컬 주소는 등록할 수 없습니다'
      });
    }
    
    // 리스팅 서버 등록/업데이트
    const existingListing = listingServers.get(url);
    const listingData = {
      url: url,
      nodeInfo: nodeInfo || {},
      lastUpdate: Date.now(),
      registeredAt: existingListing ? existingListing.registeredAt : Date.now(),
      status: 'online'
    };
    
    listingServers.set(url, listingData);
    await saveData();
    
    console.log(`🌐 리스팅 서버 등록: ${url}`);
    
    // 다른 리스팅서버들에게 업데이트 전파
    await propagateToListingServers('listing_update', { listingData });
    
    // 새로 등록된 리스팅서버에게 현재 데이터 전송
    await syncDataToListingServer(url);
    
    res.json({
      success: true,
      message: '리스팅 서버가 등록되었습니다',
      totalListingServers: listingServers.size,
      totalRelayServers: relayServers.size,
      listingData: listingData
    });
    
  } catch (error) {
    console.error('❌ 리스팅 서버 등록 실패:', error.message);
    res.status(500).json({
      success: false,
      error: '리스팅 서버 등록 중 오류가 발생했습니다'
    });
  }
});

// 리스팅 서버 목록 조회 API
app.get('/api/listing-list', (req, res) => {
  const activeThreshold = 300000; // 5분
  const listingList = Array.from(listingServers.values()).map(listing => ({
    url: listing.url,
    nodeInfo: listing.nodeInfo,
    lastUpdate: listing.lastUpdate,
    registeredAt: listing.registeredAt,
    status: Date.now() - listing.lastUpdate < activeThreshold ? 'online' : 'offline'
  }));
  
  res.json({
    success: true,
    listings: listingList,
    totalCount: listingList.length,
    onlineCount: listingList.filter(l => l.status === 'online').length,
    lastUpdated: Date.now()
  });
});

// 리스팅서버 간 데이터 동기화 API
app.post('/api/sync-data', async (req, res) => {
  try {
    const { relayServers: incomingRelays, listingServers: incomingListings, source } = req.body;
    
    let updatedRelays = 0;
    let updatedListings = 0;
    
    // 중계서버 데이터 병합
    if (incomingRelays) {
      for (const [url, relayData] of Object.entries(incomingRelays)) {
        const existing = relayServers.get(url);
        if (!existing || existing.lastUpdate < relayData.lastUpdate) {
          relayServers.set(url, relayData);
          updatedRelays++;
        }
      }
    }
    
    // 리스팅서버 데이터 병합
    if (incomingListings) {
      for (const [url, listingData] of Object.entries(incomingListings)) {
        // 자기 자신 제외
        if (url === CURRENT_SERVER_URL) continue;
        
        const existing = listingServers.get(url);
        if (!existing || existing.lastUpdate < listingData.lastUpdate) {
          listingServers.set(url, listingData);
          updatedListings++;
        }
      }
    }
    
    if (updatedRelays > 0 || updatedListings > 0) {
      await saveData();
      console.log(`🔄 데이터 동기화: 중계서버 ${updatedRelays}개, 리스팅서버 ${updatedListings}개 업데이트 (출처: ${source})`);
    }
    
    res.json({
      success: true,
      message: '데이터 동기화 완료',
      updatedRelays,
      updatedListings
    });
    
  } catch (error) {
    console.error('❌ 데이터 동기화 실패:', error.message);
    res.status(500).json({
      success: false,
      error: '데이터 동기화 중 오류가 발생했습니다'
    });
  }
});

// 중계서버 리스트 조회 API
app.get('/api/relay-list', (req, res) => {
  const activeThreshold = 600000; // 10분
  const relayList = Array.from(relayServers.values())
    .filter(relay => !isLocalUrl(relay.url)) // 로컬 주소 필터링
    .map(relay => ({
      url: relay.url,
      location: relay.location,
      nodeInfo: relay.nodeInfo,
      lastUpdate: relay.lastUpdate,
      registeredAt: relay.registeredAt,
      status: Date.now() - relay.lastUpdate < activeThreshold ? 'online' : 'offline'
    }));
  
  res.json({
    success: true,
    relays: relayList,
    totalCount: relayList.length,
    onlineCount: relayList.filter(r => r.status === 'online').length,
    lastUpdated: Date.now()
  });
});

// 중계서버 상태 업데이트 API
app.post('/api/update-relay', async (req, res) => {
  try {
    const { url, nodeInfo } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: '중계서버 URL이 필요합니다'
      });
    }
    
    const existingRelay = relayServers.get(url);
    if (!existingRelay) {
      return res.status(404).json({
        success: false,
        error: '등록되지 않은 중계서버입니다'
      });
    }
    
    // 정보 업데이트
    existingRelay.nodeInfo = { ...existingRelay.nodeInfo, ...nodeInfo };
    existingRelay.lastUpdate = Date.now();
    
    await saveData();
    
    res.json({
      success: true,
      message: '중계서버 정보가 업데이트되었습니다'
    });
    
  } catch (error) {
    console.error('❌ 중계서버 업데이트 실패:', error.message);
    res.status(500).json({
      success: false,
      error: '중계서버 업데이트 중 오류가 발생했습니다'
    });
  }
});

// 중계서버 제거 API
app.delete('/api/remove-relay', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: '중계서버 URL이 필요합니다'
      });
    }
    
    if (!relayServers.has(url)) {
      return res.status(404).json({
        success: false,
        error: '등록되지 않은 중계서버입니다'
      });
    }
    
    relayServers.delete(url);
    await saveData();
    
    console.log(`🗑️ 중계서버 제거: ${url}`);
    
    // 모든 중계서버에 리스트 업데이트 전파
    await propagateListToAllRelays();
    
    res.json({
      success: true,
      message: '중계서버가 제거되었습니다',
      totalRelays: relayServers.size
    });
    
  } catch (error) {
    console.error('❌ 중계서버 제거 실패:', error.message);
    res.status(500).json({
      success: false,
      error: '중계서버 제거 중 오류가 발생했습니다'
    });
  }
});

// 모든 중계서버에 리스트 업데이트 전파
async function propagateListToAllRelays() {
  const activeThreshold = 600000; // 10분
  const activeRelays = Array.from(relayServers.values()).filter(relay => 
    !isLocalUrl(relay.url) && Date.now() - relay.lastUpdate < activeThreshold
  );
  
  if (activeRelays.length === 0) {
    console.log('📡 활성 중계서버가 없습니다 - 리스트 전파 생략');
    return;
  }
  
  const listData = {
    type: 'relay_list_update',
    relays: activeRelays,
    timestamp: Date.now(),
    source: 'listing_server'
  };
  
  console.log(`📡 ${activeRelays.length}개 중계서버에 리스트 업데이트 전파 중...`);
  
  const promises = activeRelays.map(async (relay) => {
    try {
      const response = await fetch(`${relay.url}/api/relay-list-update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(listData),
        timeout: 5000
      });
      
      if (response.ok) {
        console.log(`✅ 리스트 업데이트 전송 성공: ${relay.url}`);
      } else {
        console.log(`❌ 리스트 업데이트 전송 실패: ${relay.url} (${response.status})`);
      }
    } catch (error) {
      console.log(`❌ 리스트 업데이트 전송 오류: ${relay.url} (${error.message})`);
    }
  });
  
  await Promise.all(promises);
  console.log('📡 리스트 업데이트 전파 완료');
}

// 리스팅 서버들에게 업데이트 전파
async function propagateToListingServers(updateType, data) {
  const activeThreshold = 300000; // 5분
  const activeListings = Array.from(listingServers.values()).filter(listing => 
    Date.now() - listing.lastUpdate < activeThreshold && listing.url !== CURRENT_SERVER_URL
  );
  
  if (activeListings.length === 0) {
    return;
  }
  
  const updateData = {
    type: updateType,
    data: data,
    timestamp: Date.now(),
    source: CURRENT_SERVER_URL
  };
  
  console.log(`🌐 ${activeListings.length}개 리스팅서버에 ${updateType} 업데이트 전파 중...`);
  
  const promises = activeListings.map(async (listing) => {
    try {
      const response = await fetch(`${listing.url}/api/sync-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...updateData,
          relayServers: updateType === 'relay_update' ? Object.fromEntries(relayServers) : undefined,
          listingServers: updateType === 'listing_update' ? Object.fromEntries(listingServers) : undefined
        }),
        timeout: 5000
      });
      
      if (response.ok) {
        console.log(`✅ ${updateType} 전송 성공: ${listing.url}`);
      } else {
        console.log(`❌ ${updateType} 전송 실패: ${listing.url} (${response.status})`);
      }
    } catch (error) {
      console.log(`❌ ${updateType} 전송 오류: ${listing.url} (${error.message})`);
    }
  });
  
  await Promise.all(promises);
}

// 특정 리스팅서버에게 전체 데이터 동기화
async function syncDataToListingServer(listingUrl) {
  try {
    const syncData = {
      relayServers: Object.fromEntries(relayServers),
      listingServers: Object.fromEntries(listingServers),
      source: CURRENT_SERVER_URL,
      timestamp: Date.now()
    };
    
    const response = await fetch(`${listingUrl}/api/sync-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(syncData),
      timeout: 10000
    });
    
    if (response.ok) {
      console.log(`✅ 전체 데이터 동기화 성공: ${listingUrl}`);
    } else {
      console.log(`❌ 전체 데이터 동기화 실패: ${listingUrl} (${response.status})`);
    }
  } catch (error) {
    console.log(`❌ 전체 데이터 동기화 오류: ${listingUrl} (${error.message})`);
  }
}

// 리스팅 서버 자동 탐색 및 등록
async function discoverAndRegisterToListingServers() {
  console.log('🔍 다른 리스팅 서버 자동 탐색 및 등록 중...');
  
  // Fly.io와 Railway를 번갈아가며 시도
  for (let i = 1; i <= 20; i++) {
    // Fly.io 시도
    const flyUrl = `https://bplisting${i}.fly.dev`;
    if (flyUrl !== CURRENT_SERVER_URL) {
      await tryRegisterToListingServer(flyUrl);
    }
    
    // Railway 시도
    const railwayUrl = `https://bplisting${i}-production.up.railway.app`;
    if (railwayUrl !== CURRENT_SERVER_URL) {
      await tryRegisterToListingServer(railwayUrl);
    }
  }
  
  // 백업 서버들도 시도 (배포 환경 전용)
  const backupServers = [
    'https://bplisting.fly.dev'
  ];
  
  for (const backupUrl of backupServers) {
    if (backupUrl !== CURRENT_SERVER_URL) {
      await tryRegisterToListingServer(backupUrl);
    }
  }
}

// 특정 리스팅 서버에 등록 시도
async function tryRegisterToListingServer(listingUrl) {
  try {
    // 먼저 상태 확인
    const statusResponse = await fetch(`${listingUrl}/api/status`, {
      method: 'GET',
      timeout: 3000
    });
    
    if (!statusResponse.ok) return;
    
    const statusData = await statusResponse.json();
    if (statusData.status !== 'running') return;
    
    // 등록 시도
    const registerResponse = await fetch(`${listingUrl}/api/register-listing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: CURRENT_SERVER_URL,
        nodeInfo: {
          version: '1.0.0',
          capabilities: ['relay_listing', 'listing_sync'],
          registeredAt: Date.now()
        },
        timestamp: Date.now()
      }),
      timeout: 5000
    });
    
    if (registerResponse.ok) {
      const registerData = await registerResponse.json();
      console.log(`✅ 리스팅 서버 등록 성공: ${listingUrl}`);
      
      // 등록된 리스팅서버 정보 로컬에 저장
      if (!listingServers.has(listingUrl)) {
        listingServers.set(listingUrl, {
          url: listingUrl,
          lastUpdate: Date.now(),
          registeredAt: Date.now(),
          status: 'online'
        });
        await saveData();
      }
    }
  } catch (error) {
    // 조용히 실패 - 다음 서버로 계속
  }
}

// 오프라인 서버들 정리
async function cleanupOfflineServers() {
  const relayActiveThreshold = 1800000; // 30분
  const listingActiveThreshold = 900000; // 15분
  
  let removedRelays = 0;
  let removedListings = 0;
  
  // 오프라인 중계서버 및 로컬 주소 제거
  for (const [url, relay] of relayServers.entries()) {
    const isOffline = Date.now() - relay.lastUpdate > relayActiveThreshold;
    const isLocal = isLocalUrl(url);
    
    if (isOffline || isLocal) {
      relayServers.delete(url);
      removedRelays++;
      console.log(`🗑️ ${isLocal ? '로컬 주소' : '오프라인'} 중계서버 제거: ${url}`);
    }
  }
  
  // 오프라인 리스팅서버 및 로컬 주소 제거
  for (const [url, listing] of listingServers.entries()) {
    const isOffline = Date.now() - listing.lastUpdate > listingActiveThreshold;
    const isLocal = isLocalUrl(url);
    
    if (isOffline || isLocal) {
      listingServers.delete(url);
      removedListings++;
      console.log(`🗑️ ${isLocal ? '로컬 주소' : '오프라인'} 리스팅서버 제거: ${url}`);
    }
  }
  
  if (removedRelays > 0 || removedListings > 0) {
    await saveData();
    console.log(`🧹 정리 완료: 중계서버 ${removedRelays}개, 리스팅서버 ${removedListings}개 제거`);
    
    // 변경사항을 다른 리스팅서버들에게 전파
    if (removedRelays > 0) {
      await propagateToListingServers('relay_cleanup', { removedCount: removedRelays });
    }
    if (removedListings > 0) {
      await propagateToListingServers('listing_cleanup', { removedCount: removedListings });
    }
  }
}

// 상태 API
app.get('/api/status', (req, res) => {
  const relayActiveThreshold = 600000; // 10분
  const listingActiveThreshold = 300000; // 5분
  
  // 로컬 주소 제외하고 카운트
  const relayList = Array.from(relayServers.values()).filter(relay => !isLocalUrl(relay.url));
  const onlineRelayCount = relayList.filter(relay => 
    Date.now() - relay.lastUpdate < relayActiveThreshold
  ).length;
  
  const listingList = Array.from(listingServers.values()).filter(listing => !isLocalUrl(listing.url));
  const onlineListingCount = listingList.filter(listing => 
    Date.now() - listing.lastUpdate < listingActiveThreshold
  ).length;
  
  res.json({
    success: true,
    status: 'running',
    totalRelays: relayList.length,
    onlineRelays: onlineRelayCount,
    offlineRelays: relayList.length - onlineRelayCount,
    totalListingServers: listingList.length,
    onlineListingServers: onlineListingCount,
    offlineListingServers: listingList.length - onlineListingCount,
    serverUrl: CURRENT_SERVER_URL,
    uptime: process.uptime(),
    lastUpdated: Date.now()
  });
});

// 헬스체크 API
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    uptime: process.uptime()
  });
});

// 404 핸들링
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    error: '요청한 리소스를 찾을 수 없습니다' 
  });
});

// 서버 시작
async function startServer() {
  try {
    // 데이터 로드
    await loadData();
    
    // 즉시 로컬 주소 정리
    await cleanupOfflineServers();
    
    // 서버 시작
    app.listen(port, '0.0.0.0', () => {
      console.log(`\n🌟 백야 프로토콜 중계서버 리스팅 서버 시작!`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🌐 서버 URL: ${CURRENT_SERVER_URL}`);
      console.log(`🌐 로컬 API: http://localhost:${port}`);
      console.log(`📡 중계서버 등록: ${CURRENT_SERVER_URL}/api/register-relay`);
      console.log(`🌐 리스팅서버 등록: ${CURRENT_SERVER_URL}/api/register-listing`);
      console.log(`📋 중계서버 리스트: ${CURRENT_SERVER_URL}/api/relay-list`);
      console.log(`📋 리스팅서버 리스트: ${CURRENT_SERVER_URL}/api/listing-list`);
      console.log(`📊 상태 API: ${CURRENT_SERVER_URL}/api/status`);
      console.log(`❤️ 헬스체크: ${CURRENT_SERVER_URL}/health`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
      
      console.log(`📊 현재 등록된 중계서버: ${relayServers.size}개`);
      console.log(`🌐 현재 등록된 리스팅서버: ${listingServers.size}개`);
      
      // 환경 정보 디버깅
      const envInfo = [];
      if (process.env.RAILWAY_PUBLIC_DOMAIN) envInfo.push(`Railway (${process.env.RAILWAY_PUBLIC_DOMAIN})`);
      if (process.env.FLY_APP_NAME) envInfo.push(`Fly.io (${process.env.FLY_APP_NAME})`);
      if (process.env.FLY_ALLOC_ID) envInfo.push(`Fly.io (ID: ${process.env.FLY_ALLOC_ID})`);
      if (process.env.FLY_REGION) envInfo.push(`Fly.io (Region: ${process.env.FLY_REGION})`);
      if (process.env.RAILWAY_ENVIRONMENT) envInfo.push(`Railway Env`);
      
      const detectedEnv = envInfo.length > 0 ? envInfo.join(', ') : 'Local';
      console.log(`🔗 감지된 서버 환경: ${detectedEnv}`);
      console.log(`🌐 포트: ${port} | 감지된 URL: ${CURRENT_SERVER_URL}\n`);
      
      // 다른 리스팅 서버들에 자동 등록 시작 (5초 후)
      setTimeout(() => {
        discoverAndRegisterToListingServers();
      }, 5000);
      
      // 주기적으로 리스팅 서버 등록 시도 (5분마다)
      setInterval(() => {
        discoverAndRegisterToListingServers();
      }, 300000);
      
      // 주기적으로 오프라인 서버 정리 (10분마다)
      setInterval(() => {
        cleanupOfflineServers();
      }, 600000);
    });
    
  } catch (error) {
    console.error('❌ 서버 시작 실패:', error);
    process.exit(1);
  }
}

// 정리 작업
process.on('SIGINT', async () => {
  console.log('\n🛑 서버 종료 중...');
  await saveData();
  console.log('✅ 데이터 저장 완료');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 서버 종료 중...');
  await saveData();
  console.log('✅ 데이터 저장 완료');
  process.exit(0);
});

// 서버 시작
startServer();

module.exports = app;

// BROTHERHOOD 웹앱 설정

// 릴레이 서버 URL 설정
// Capacitor 환경 감지
const isCapacitor = window.Capacitor && window.Capacitor.isNativePlatform();

// DAppManager에서 최적 릴레이 선택하도록 설정
window.USE_RELAY_NODES = true;

// 개발/테스트 모드에서만 로컬 서버 사용
if (window.location.hostname === 'localhost' && window.location.port === '8000') {
  // 웹앱 개발 모드에서는 로컬 서버 사용
  window.RELAY_SERVER_URL = 'http://localhost:3000';
  window.USE_RELAY_NODES = false;
  console.log('🛠️ 개발 모드 - 로컬 서버 사용:', window.RELAY_SERVER_URL);
} else {
  // 실제 운영에서는 릴레이 노드 자동 선택
  console.log('🌐 릴레이 노드 자동 선택 모드');
}

// 기타 설정
window.APP_CONFIG = {
  // 앱 버전
  version: '1.0.0',
  
  // 디버그 모드
  debug: true,
  
  // API 타임아웃 (밀리초)
  apiTimeout: 30000,
  
  // WebSocket 재연결 시도 간격 (밀리초)
  wsReconnectInterval: 5000,
  
  // 최대 재연결 시도 횟수
  maxReconnectAttempts: 10,
  
  // 기본 언어
  language: 'ko',
  
  // 기능 플래그
  features: {
    // P2P 기능 활성화 (모바일 앱에서만)
    p2p: isCapacitor,
    
    // 생체인증 (추후 구현)
    biometric: isCapacitor,
    
    // 자동 로그인
    autoLogin: true,
    
    // 실시간 업데이트
    realTimeUpdates: true
  }
}; 
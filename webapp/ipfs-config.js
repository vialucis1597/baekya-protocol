// IPFS 배포 설정 파일
// Pinata만 사용

window.IPFS_CONFIG = {
  // Pinata 설정
  PINATA_API_KEY: 'YOUR_PINATA_API_KEY_HERE',
  PINATA_SECRET_KEY: 'YOUR_PINATA_SECRET_KEY_HERE',
  
  // 기본 배포 방법
  DEFAULT_METHOD: 'pinata'
};

// 설정 값들을 window 객체에 직접 할당
Object.assign(window, window.IPFS_CONFIG);


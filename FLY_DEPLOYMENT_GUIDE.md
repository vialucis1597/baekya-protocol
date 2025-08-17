# Fly.io 배포 가이드

백야 프로토콜을 Fly.io에 배포하는 방법입니다.

## 사전 준비

### 1. Fly CLI 설치
```powershell
# PowerShell에서 설치
pwsh -c "iwr https://fly.io/install.ps1 -useb | iex"
```

### 2. Fly.io 계정 로그인
```bash
fly auth login
```

## 배포 스크립트

### 리스팅 서버 배포
```powershell
.\deploy-flyio-listing.ps1
```

### 릴레이 서버 배포
```powershell
.\deploy-flyio-relay.ps1
```

## 배포 파일 구조

### 리스팅 서버 (`deploy-flyio-listing.ps1`)
- **메인 파일**: `listing-server.js`
- **설정 파일**: `fly-listing.toml`
- **도커파일**: `Dockerfile.flyio.listing`
- **패키지**: `railway-listing.json` → `package.json`

### 릴레이 서버 (`deploy-flyio-relay.ps1`)
- **메인 파일**: `p2p-relay-server.js`
- **설정 파일**: `fly-relay.toml`
- **도커파일**: `Dockerfile.flyio.relay`
- **패키지**: `railway-relay.json` → `package.json`

## 배포 특징

### ✅ 최적화된 배포
- **필요한 파일만 배포**: 전체 폴더가 아닌 서버별 필수 파일만 배포
- **빠른 빌드**: 불필요한 파일 제외로 빌드 속도 향상
- **작은 이미지 크기**: Alpine Linux 기반으로 경량화

### ✅ 아시아 최적화
- **Tokyo 리전 (nrt)**: 한국에서 가장 빠른 리전
- **낮은 지연시간**: 아시아 사용자에게 최적화

### ✅ 자동 복구
- **파일 백업/복구**: 배포 실패 시 원본 파일 자동 복구
- **에러 핸들링**: 상세한 오류 메시지와 복구 절차

## 환경 변수

### 리스팅 서버
- `NODE_ENV=production`
- `PORT=4000`

### 릴레이 서버
- `NODE_ENV=production`
- `PORT=3000`
- `RELAY_PASSWORD=xxx` (8자 이상)
- `RELAY_LOCATION=37.5665,126.9780` (Seoul)

## 사용법

1. **Fly CLI 설치 및 로그인**
2. **리스팅 서버 배포**:
   ```powershell
   .\deploy-flyio-listing.ps1
   ```
3. **릴레이 서버 배포**:
   ```powershell
   .\deploy-flyio-relay.ps1
   ```
4. **배포 완료 후 URL 확인**

## 모니터링

- **Health Check**: 자동 헬스체크 설정
- **로그 확인**: `fly logs --app [앱이름]`
- **상태 확인**: `fly status --app [앱이름]`

## Railway vs Fly.io 비교

| 항목 | Railway | Fly.io |
|------|---------|--------|
| 속도 | 보통 | 빠름 |
| 가격 | 무료 제한적 | 무료 더 관대 |
| 지역 | 제한적 | 글로벌 |
| 안정성 | 보통 | 높음 |
| 설정 | 간단 | 유연함 |

**결론**: Fly.io가 성능과 안정성 면에서 더 우수합니다!


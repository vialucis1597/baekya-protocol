# 실제 IPFS 배포 가이드

레포지토리 기능에서 Pinata를 통한 실제 IPFS 배포를 사용하는 방법입니다.

⚠️ **2024년 업데이트**: Web3.Storage는 새로운 사용자 가입을 중단했습니다. 현재는 **Pinata만 사용 가능**합니다.

## Pinata 사용법

### 단계 1: Pinata 계정 생성
1. [pinata.cloud](https://pinata.cloud)에 접속
2. 무료 계정 생성 (1GB 무료 스토리지 제공)
3. 대시보드 로그인

### 단계 2: API 키 발급
1. Pinata 대시보드에서 **API Keys** 클릭
2. **New Key** 버튼 클릭
3. 권한 설정:
   - `pinFileToIPFS` 체크
   - `pinJSONToIPFS` 체크 (선택사항)
4. Key Name 입력 (예: "baekya-protocol")
5. **Create Key** 클릭
6. **API Key**와 **API Secret** 복사 (안전한 곳에 보관)

### 단계 3: 웹앱에서 설정
1. 거버넌스 → 레포지토리 탭 이동
2. **IPFS 설정** 버튼 클릭
3. **Pinata (추천)** 선택
4. API Key와 Secret Key 입력
5. **설정 저장** 클릭

## 2. 배포 테스트

### 테스트 파일 준비
1. 간단한 텍스트 파일 생성 (예: `test.txt`)
2. 내용: "안녕하세요, IPFS 테스트입니다!"

### 업로드 과정
1. **생성하기** 버튼 클릭
2. 레포지토리 이름: "테스트 프로젝트"
3. 설명: "IPFS 배포 테스트"
4. 파일 선택 또는 드래그 앤 드롭
5. **레포지토리 생성** 클릭
6. 배포 완료 후 URL 확인

### 성공 확인
- 생성된 IPFS URL 클릭
- 새 탭에서 프로젝트 페이지 로드 확인
- 업로드한 파일 내용 확인

## 3. 문제 해결

### 일반적인 오류

#### "API 키가 설정되지 않았습니다"
- IPFS 설정에서 올바른 API 키 입력 확인
- 키에 공백이나 특수문자 포함되지 않았는지 확인

#### "네트워크 오류"
- 인터넷 연결 확인
- 방화벽이나 브라우저 확장 프로그램 확인
- CORS 정책으로 인한 차단 가능성

#### "업로드 실패"
- 파일 크기 확인 (Pinata는 100MB 제한)
- API 키 권한 확인
- Pinata 서비스 상태 페이지 확인

### 브라우저별 호환성
- **Chrome/Edge**: 완전 지원
- **Firefox**: 완전 지원
- **Safari**: 완전 지원

## 4. 고급 사용법

### 사용자 정의 게이트웨이
`app.js`에서 IPFS 게이트웨이 URL 변경 가능:
```javascript
// Pinata 전용 게이트웨이 사용 (기본)
return `https://gateway.pinata.cloud/ipfs/${result.IpfsHash}`;

// 다른 게이트웨이 사용
return `https://ipfs.io/ipfs/${result.IpfsHash}`;
return `https://cloudflare-ipfs.com/ipfs/${result.IpfsHash}`;
```

### 메타데이터 추가
Pinata 업로드 시 프로젝트 정보 메타데이터 자동 추가:
- 프로젝트 이름
- 생성 날짜
- 타입: "baekya-repository"

## 5. 보안 주의사항

### API 키 보안
- **절대 공개 리포지토리에 커밋하지 마세요**
- 로컬 스토리지에만 저장
- 정기적으로 키 갱신
- 불필요한 권한은 부여하지 마세요

### IPFS 특성
- **업로드된 파일은 공개됩니다**
- **삭제가 어렵습니다** (분산 특성)
- 개인정보나 민감한 정보 업로드 금지

## 6. 비용 정보

### Pinata
- **무료**: 1GB 스토리지, 월 1GB 대역폭
- **유료**: 월 $20부터 (10GB 스토리지)

이제 실제 IPFS 네트워크에 분산 레포지토리를 배포할 수 있습니다! 🚀


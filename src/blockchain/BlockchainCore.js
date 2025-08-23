const Block = require('./Block');
const Transaction = require('./Transaction');
const PoCConsensus = require('./PoCConsensus');
const P2PNetwork = require('./P2PNetwork');

  class BlockchainCore {
    constructor() {
      this.dataStorage = null; // 영구 저장소
      this.authSystem = null; // 인증 시스템 참조
      this.chain = []; // 저장소 연결 후에 초기화됨
      this.difficulty = 2;
    this.pendingTransactions = [];
    this.miningReward = 100;
    this.validators = new Map(); // validatorDID -> 등록 정보
    this.testBalances = new Map(); // 테스트용 잔액 저장
    this.isInitialized = false;
    
    // P2P 네트워크 초기화
    this.p2pNetwork = new P2PNetwork();
    this.setupP2PListeners();
    
    // PoC 합의 메커니즘 초기화
    this.pocConsensus = new PoCConsensus();
    
    console.log('🚀 백야 프로토콜 블록체인 코어 생성 (저장소 연결 대기 중)');
  }
  
  // 영구 저장소 설정
  setDataStorage(storage) {
    console.log('💾 BlockchainCore에 영구 저장소 연결');
    this.dataStorage = storage;
    this.loadChainFromStorage();
  }

  // 인증 시스템 설정
  setAuthSystem(authSystem) {
    console.log('🔐 BlockchainCore에 인증 시스템 연결');
    this.authSystem = authSystem;
  }
  
  // 저장소에서 블록체인 로드
  loadChainFromStorage() {
    if (!this.dataStorage) {
      this.chain = [this.createGenesisBlock()];
      this.isInitialized = true;
      return;
    }
    
    const savedChain = this.dataStorage.getBlockchain();
    if (savedChain && savedChain.length > 0) {
      this.chain = savedChain.map(blockData => {
        const block = new Block();
        Object.assign(block, blockData);
        block.transactions = blockData.transactions.map(txData => {
          const tx = new Transaction();
          Object.assign(tx, txData);
          return tx;
        });
        return block;
      });
      console.log(`💾 저장소에서 ${this.chain.length}개 블록 로드 완료`);
    } else {
      console.log('💾 저장된 체인이 없음 - 제네시스 블록 생성');
      this.chain = [this.createGenesisBlock()];
      this.saveChainToStorage();
    }
    
    // 블록체인 로드 후 검증자 풀 재계산
    if (this.dataStorage) {
      console.log('🔄 검증자 풀 재계산 중...');
      this.dataStorage.resetValidatorPool();
      
      // 모든 블록의 트랜잭션을 다시 처리하여 검증자 풀 계산
      for (let i = 1; i < this.chain.length; i++) { // 제네시스 블록 제외
        const block = this.chain[i];
        for (const tx of block.transactions) {
          // 검증자 풀 후원 트랜잭션만 처리
          if (tx.toDID === 'did:baekya:system0000000000000000000000000000000001' && 
              tx.tokenType === 'B-Token' && 
              tx.data?.type === 'validator_pool_sponsor') {
            // 검증자 풀에는 후원금 + 검증자 수수료만 들어감
            const poolAmount = (tx.data.actualSponsorAmount || 0) + (tx.data.validatorFee || 0);
            this.dataStorage.updateValidatorPool(tx.fromDID, poolAmount);
          }
        }
      }
      
      const poolStatus = this.dataStorage.getValidatorPoolStatus();
      console.log(`✅ 검증자 풀 재계산 완료: ${poolStatus.totalStake}B`);
    }
    
    this.isInitialized = true;
    console.log('✅ 블록체인 초기화 완료');
  }
  
  // 블록체인을 저장소에 저장
  saveChainToStorage() {
    if (!this.dataStorage) return;
    
    this.dataStorage.saveBlockchain(this.chain.map(block => ({
      index: block.index,
      timestamp: block.timestamp,
      transactions: block.transactions,
      previousHash: block.previousHash,
      hash: block.hash,
      nonce: block.nonce,
      validator: block.validator,
      data: block.data
    })));
  }

  // 제네시스 블록 생성
  createGenesisBlock() {
    const Transaction = require('./Transaction');
    
    const genesisData = {
      type: 'genesis',
      message: '백야 프로토콜 제네시스 블록',
      timestamp: Date.now()
    };

    // 초기 토큰 발행 트랜잭션들 생성
    const initialTransactions = [];
    
    // 테스트넷 기본 사용자들에게 초기 토큰 발행
    const testUsers = [
      'did:baekya:test001000000000000000000000000000000',
      'did:baekya:test002000000000000000000000000000000',
      'did:baekya:test003000000000000000000000000000000',
      'did:baekya:validator001000000000000000000000000000',
      'did:baekya:validator002000000000000000000000000000',
      'did:baekya:validator003000000000000000000000000000'
    ];

    // 각 테스트 사용자에게 초기 B-Token 1000개, P-Token 100개 발행
    testUsers.forEach((userDID) => {
      // B-Token 발행
      const bTokenTx = new Transaction(
        'did:baekya:system000000000000000000000000000000000',
        userDID,
        1000,
        'B-Token',
        'genesis-initial-btokens'
      );
      bTokenTx.signature = 'genesis-signature';
      initialTransactions.push(bTokenTx);

      // P-Token 발행
      const pTokenTx = new Transaction(
        'did:baekya:system000000000000000000000000000000000',
        userDID,
        100,
        'P-Token',
        'genesis-initial-ptokens'
      );
      pTokenTx.signature = 'genesis-signature';
      initialTransactions.push(pTokenTx);
    });

    const genesisBlock = new Block(
      0,
      '0',
      initialTransactions,
      'did:baekya:genesis000000000000000000000000000000000000',
      0
    );

    // 제네시스 블록 데이터 설정
    genesisBlock.data = genesisData;
    genesisBlock.hash = genesisBlock.calculateHash();

    console.log(`🎯 제네시스 블록 생성 완료 (${initialTransactions.length}개 초기 트랜잭션 포함)`);
    return genesisBlock;
  }

  // 최신 블록 조회
  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  // 새 블록 생성
  createBlock(transactions, validatorDID) {
    const previousBlock = this.getLatestBlock();
    const newBlock = new Block(
      previousBlock.index + 1,
      previousBlock.hash,
      transactions,
      validatorDID,
      this.difficulty
    );

    // 이전 블록과 최소 1ms 간격 보장
    if (newBlock.timestamp <= previousBlock.timestamp) {
      newBlock.timestamp = previousBlock.timestamp + 1;
      newBlock.hash = newBlock.calculateHash();
    }

    // 블록 채굴
    newBlock.mineBlock();
    
    console.log(`⛏️ 새 블록 생성 완료 - 인덱스: ${newBlock.index}, 검증자: ${validatorDID.substring(0, 8)}...`);
    return newBlock;
  }

  // 블록 체인에 추가
  addBlock(newBlock) {
    try {
      // 타임스탬프 검증 (보안 강화 - 미래 시간 1분으로 제한)
      const currentTime = Date.now();
      const maxFutureTime = currentTime + 60 * 1000; // 1분 허용
      
      if (newBlock.timestamp > maxFutureTime) {
        return {
          success: false,
          error: '유효하지 않은 타임스탬프 (미래 시간 초과)'
        };
      }

      // 과거 시간 제한 (24시간 이내)
      const minPastTime = currentTime - 24 * 60 * 60 * 1000; // 24시간
      if (newBlock.timestamp < minPastTime) {
        return {
          success: false,
          error: '유효하지 않은 타임스탬프 (너무 오래된 블록)'
        };
      }

      // 블록 유효성 검증
      const previousBlock = this.getLatestBlock();
      if (!newBlock.isValid(previousBlock)) {
        return {
          success: false,
          error: '유효하지 않은 블록입니다'
        };
      }

      // 이중 지출 검증 (보안 강화)
      if (!this.validateNoDoubleSpending(newBlock.transactions)) {
        return {
          success: false,
          error: '이중 지출이 감지되었습니다'
        };
      }

      // PoC 합의 검증
      if (!this.pocConsensus.validateBlock(newBlock)) {
        return {
          success: false,
          error: '기여도 검증에 실패했습니다'
        };
      }

      // 체인에 블록 추가
      this.chain.push(newBlock);
      
      // 영구 저장소에 저장
      this.saveChainToStorage();
      
      // 블록의 트랜잭션들을 영구 저장소에 기록
      this.updateStorageFromBlock(newBlock);

      // 검증자에게 보상 지급은 mineBlock에서만 발생
      // addBlock에서는 보상 지급하지 않음 (테스트 잔액 계산 정확성을 위해)

      // 처리된 트랜잭션 제거
      this.removePendingTransactions(newBlock.transactions);

      // 네트워크에 새 블록 브로드캐스트
      this.p2pNetwork.broadcastBlock(newBlock);
      this.p2pNetwork.broadcast('newBlock', newBlock.toJSON());

      console.log(`✅ 블록 #${newBlock.index} 체인에 추가됨`);
      
      return {
        success: true,
        block: newBlock,
        chainLength: this.chain.length
      };

    } catch (error) {
      console.error('❌ 블록 추가 실패:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 이중 지출 검증 (보안 강화)
   * @private
   */
  validateNoDoubleSpending(transactions) {
    const spentOutputs = new Set();
    
    for (const tx of transactions) {
      // 시스템 트랜잭션은 이중 지출 검증 제외
      if (tx.fromDID.includes('system') || tx.fromDID.includes('genesis')) {
        continue;
      }

      const outputKey = `${tx.fromDID}-${tx.tokenType}-${tx.amount}-${tx.timestamp}`;
      
      if (spentOutputs.has(outputKey)) {
        console.warn(`이중 지출 감지: ${outputKey}`);
        return false;
      }
      
      spentOutputs.add(outputKey);
    }

    // 체인 전체에서 이중 지출 검증
    for (const tx of transactions) {
      if (tx.fromDID.includes('system') || tx.fromDID.includes('genesis')) {
        continue;
      }

      if (this.isTransactionAlreadyInChain(tx)) {
        console.warn(`중복 트랜잭션 감지: ${tx.hash}`);
        return false;
      }
    }

    return true;
  }

  /**
   * 트랜잭션이 이미 체인에 있는지 확인
   * @private
   */
  isTransactionAlreadyInChain(transaction) {
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.hash === transaction.hash) {
          return true;
        }
      }
    }
    return false;
  }

  // 트랜잭션을 풀에 추가 (보안 강화)
  addTransaction(transaction) {
    // 기본 필드 검증 먼저 (빈 DID 등)
    if (!transaction.fromDID || !transaction.toDID) {
      return {
        success: false,
        error: '유효하지 않은 트랜잭션입니다'
      };
    }

    // 무결성 검증 (보안 강화)
    const integrityValid = transaction.verifyIntegrity();
    if (!integrityValid) {
      return {
        success: false,
        error: '트랜잭션 무결성 검증 실패'
      };
    }

    // 서명 검증
    if (!transaction.signature) {
      return {
        success: false,
        error: '서명되지 않은 트랜잭션입니다'
      };
    }

    // 금액 검증 - 특정 트랜잭션 타입은 0 금액 허용
    // 금액이 0이어도 허용되는 트랜잭션 타입들
    const zeroAmountAllowedTypes = [
      'invite_code_registration',
      'dca_verification',
      'system_notification',
      'metadata_update',
      'governance_proposal_creation' // 거버넌스 제안 생성
    ];
    
    const isZeroAmountAllowed = transaction.data?.type && 
      zeroAmountAllowedTypes.includes(transaction.data.type);
    
    if (typeof transaction.amount !== 'number' || 
        (!isZeroAmountAllowed && transaction.amount < 0)) {  // 0 이상 허용으로 변경
      return {
        success: false,
        error: '유효하지 않은 금액입니다'
      };
    }

    // 최대 금액 제한 (보안)
    const maxAmount = 1000000000; // 10억 한도
    if (transaction.amount > maxAmount) {
      return {
        success: false,
        error: `금액이 너무 큽니다 (최대: ${maxAmount})`
      };
    }

    // 전체 유효성 검증 (DID 레지스트리 전달)
    const isValidResult = transaction.isValid(this.didRegistry);
    if (!isValidResult) {
      return {
        success: false,
        error: '유효하지 않은 트랜잭션입니다'
      };
    }

    // 시스템 트랜잭션 제한 (보안 강화)
    if (transaction.fromDID.includes('system')) {
      // 시스템 트랜잭션은 특정 타입만 허용
      const allowedSystemTypes = [
        'genesis-initial-btokens',
        'genesis-initial-ptokens', 
        'mining_reward',
        'contribution_reward',
        'p_token_distribution',
        'invite_reward',
        'github_integration',      // GitHub 연동 보상
        'dca_reward',             // DCA 기여 보상
        'validator_reward',       // 검증자 보상
        'pr_merged_reward',       // PR 병합 보상
        'pr_review_reward',       // PR 리뷰 보상
        'issue_resolved_reward',  // Issue 해결 보상
        'github_integration_bonus', // GitHub 연동 보너스
        'governance_proposal_creation', // 거버넌스 제안 생성
        'governance_vote',        // 거버넌스 투표
        'governance_collaboration_transition', // 거버넌스 협업 단계 전환
        'relay_reward'           // 릴레이 노드 보상
      ];
      
      if (!allowedSystemTypes.includes(transaction.data?.type || transaction.data)) {
        return {
          success: false,
          error: '허용되지 않은 시스템 트랜잭션 타입'
        };
      }
    }

    // 시스템 트랜잭션 또는 0원 거버넌스 트랜잭션은 잔액 검증 건너뛰기
    if (!transaction.fromDID.includes('system') && 
        !(transaction.amount === 0 && isZeroAmountAllowed)) {
      // 잔액 검증 - 대기 중인 트랜잭션도 고려
      const senderBalance = this.getBalance(transaction.fromDID, transaction.tokenType);
      
      // 대기 중인 트랜잭션들의 총 지출액 계산
      const pendingSpent = this.pendingTransactions
        .filter(tx => tx.fromDID === transaction.fromDID && tx.tokenType === transaction.tokenType)
        .reduce((total, tx) => total + tx.amount, 0);
      
      const availableBalance = senderBalance - pendingSpent;
      
      if (availableBalance < transaction.amount) {
        return {
          success: false,
          error: `잔액 부족: 사용 가능 ${availableBalance}, 필요 ${transaction.amount}`
        };
      }
    }

    // 수신자의 잔액도 업데이트 (대기 중인 트랜잭션 고려)
    if (!transaction.toDID.includes('system')) {
      // 수신자가 받을 예정인 대기 중인 트랜잭션들 계산
      const pendingReceived = this.pendingTransactions
        .filter(tx => tx.toDID === transaction.toDID && tx.tokenType === transaction.tokenType)
        .reduce((total, tx) => total + tx.amount, 0);
      
      // 수신자의 현재 잔액 + 받을 예정 금액이 충분한지 확인 (향후 트랜잭션을 위해)
      const receiverBalance = this.getBalance(transaction.toDID, transaction.tokenType);
      const totalReceived = receiverBalance + pendingReceived;
      
      // 이 정보는 로깅용으로만 사용 (실제 검증은 하지 않음)
      console.log(`💰 ${transaction.toDID.substring(0, 8)}... 예상 잔액: ${totalReceived + transaction.amount}`);
    }

    // 중복 트랜잭션 검증 (보안 강화)
    const uniqueId = transaction.getUniqueIdentifier();
    const isDuplicate = this.pendingTransactions.some(tx => 
      tx.getUniqueIdentifier() === uniqueId ||
      tx.hash === transaction.hash ||
      (tx.fromDID === transaction.fromDID && 
       tx.toDID === transaction.toDID && 
       tx.amount === transaction.amount && 
       tx.tokenType === transaction.tokenType &&
       Math.abs(tx.timestamp - transaction.timestamp) < 5000) // 5초 이내 동일 트랜잭션
    );

    if (isDuplicate) {
      return {
        success: false,
        error: '중복된 트랜잭션입니다'
      };
    }

    // 트랜잭션 풀 크기 제한 (보안)
    const maxPoolSize = 10000;
    if (this.pendingTransactions.length >= maxPoolSize) {
      return {
        success: false,
        error: '트랜잭션 풀이 포화상태입니다'
      };
    }

    // 트랜잭션 풀에 추가
    this.pendingTransactions.push(transaction);

    // P2P 네트워크에 브로드캐스트
    if (this.p2pNetwork) {
      this.p2pNetwork.broadcastTransaction(transaction);
    }

    console.log(`📝 트랜잭션 추가됨: ${transaction.fromDID.substring(0, 8)}... -> ${transaction.toDID.substring(0, 8)}... (${transaction.amount} ${transaction.tokenType})`);
    console.log(`✅ addTransaction 성공 반환`);

    return {
      success: true,
      transaction: transaction
    };
  }

  // 처리된 트랜잭션을 풀에서 제거
  removePendingTransactions(processedTransactions) {
    const processedHashes = processedTransactions.map(tx => tx.hash);
    this.pendingTransactions = this.pendingTransactions.filter(tx => 
      !processedHashes.includes(tx.hash)
    );
  }
  
  // 블록의 트랜잭션들을 영구 저장소에 반영
  updateStorageFromBlock(block) {
    if (!this.dataStorage) return;
    
    for (const tx of block.transactions) {
      // 트랜잭션 기록
      this.dataStorage.recordTransaction(tx);
      
      // 토큰 잔액 업데이트
      if (!tx.fromDID.includes('system') && !tx.fromDID.includes('genesis')) {
        const fromBalance = this.getBalance(tx.fromDID, tx.tokenType);
        this.dataStorage.setTokenBalance(tx.fromDID, fromBalance, tx.tokenType.replace('-Token', ''));
      }
      
      if (!tx.toDID.includes('system')) {
        const toBalance = this.getBalance(tx.toDID, tx.tokenType);
        this.dataStorage.setTokenBalance(tx.toDID, toBalance, tx.tokenType.replace('-Token', ''));
      }
      
      // 검증자 풀 후원인 경우 - 실제 후원 금액과 수수료를 분리해서 처리
      if (tx.toDID === 'did:baekya:system0000000000000000000000000000000001' && tx.tokenType === 'B-Token' && tx.data?.type === 'validator_pool_sponsor') {
        // 검증자 풀에는 후원금 + 검증자 수수료만 들어감 (10B + 0.0006B = 10.0006B)
        const poolAmount = (tx.data.actualSponsorAmount || 0) + (tx.data.validatorFee || 0);
        this.dataStorage.updateValidatorPool(tx.fromDID, poolAmount);
        
        // TODO: DAO 수수료(tx.data.daoFee = 0.0004B) 처리 로직 추가 필요
      }
      
      // DAO 금고 후원인 경우
      if (tx.data?.type === 'dao_treasury_sponsor') {
        const targetDaoId = tx.data.targetDaoId;
        const targetDaoAmount = tx.data.actualSponsorAmount || 0;
        
        // 대상 DAO 금고에 후원금 업데이트 (수수료 제외한 순수 후원금만)
        if (targetDaoId && targetDaoAmount > 0) {
          this.dataStorage.updateDAOTreasury(targetDaoId, targetDaoAmount);
        }
        
        // 검증자 풀에 수수료 추가
        if (tx.data.validatorFee > 0) {
          this.dataStorage.updateValidatorPool(tx.fromDID, tx.data.validatorFee);
        }
        
        // DAO 수수료 분배는 server.js에서 사용자 소속 DAO들에게 처리
        // 블록체인에서는 대상 DAO와 검증자 풀 업데이트만 처리
      }
      
      // DAO 수수료 분배 - 100% 검증자 풀로 변경됨으로 제거됨
      // dao_fee_distribution 타입 트랜잭션 처리 제거됨
      
      // 토큰 전송 수수료인 경우
      if (tx.data?.type === 'transfer_fee') {
        // 검증자 풀에 수수료 추가
        if (tx.data.validatorFee > 0) {
          this.dataStorage.updateValidatorPool(tx.fromDID, tx.data.validatorFee);
        }
        // DAO 수수료는 별도 트랜잭션으로 처리됨
      }
    }
  }

  // 블록체인 유효성 검증
  isChainValid() {
    console.log('🔍 블록체인 유효성 검증 시작...');

    // 제네시스 블록 검증
    const genesisBlock = this.chain[0];
    if (genesisBlock.index !== 0 || genesisBlock.previousHash !== '0') {
      console.error('❌ 제네시스 블록이 올바르지 않습니다');
      return false;
    }

    // 각 블록 검증
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      console.log(`🔍 블록 #${i} 검증 중...`);

      // 블록 자체 유효성 검증
      if (!currentBlock.isValid(previousBlock)) {
        console.error(`❌ 블록 #${currentBlock.index}이 유효하지 않습니다`);
        return false;
      }

      // 이전 블록과의 연결 검증
      if (currentBlock.previousHash !== previousBlock.hash) {
        console.error(`❌ 블록 #${currentBlock.index} 해시 연결 오류`);
        return false;
      }

      // 인덱스 순서 검증
      if (currentBlock.index !== previousBlock.index + 1) {
        console.error(`❌ 블록 #${currentBlock.index} 인덱스 순서 오류`);
        return false;
      }

      // 타임스탬프 검증 (이전 블록보다 나중이어야 함)
      if (currentBlock.timestamp <= previousBlock.timestamp) {
        console.error(`❌ 블록 #${currentBlock.index} 타임스탬프 오류`);
        return false;
      }

      console.log(`✅ 블록 #${i} 검증 통과`);
    }

    console.log('✅ 블록체인 유효성 검증 성공');
    return true;
  }

  // 블록 채굴 (검증자 선택 및 블록 생성)
  mineBlock(transactionsOrValidators = [], validatorDID = null) {
    // 매개변수 분석: 첫 번째 인자가 트랜잭션 배열인지 검증자 배열인지 확인
    let validatorCandidates = [];
    let transactionsToMine = [];
    
    if (validatorDID) {
      // mineBlock([transactions], validatorDID) 형태
      transactionsToMine = transactionsOrValidators;
      validatorCandidates = [validatorDID];
    } else if (transactionsOrValidators.length > 0 && transactionsOrValidators[0].hash) {
      // 트랜잭션 배열이 전달된 경우
      transactionsToMine = transactionsOrValidators;
    } else {
      // 검증자 배열이 전달된 경우
      validatorCandidates = transactionsOrValidators;
      transactionsToMine = this.pendingTransactions.slice(0, 10);
    }

        if (transactionsToMine.length === 0 && this.pendingTransactions.length === 0) {
      return {
        success: false,
        error: '채굴할 트랜잭션이 없습니다'
      };
    }

    try {
      // 검증자 선택
      let selectedValidator;
      if (validatorCandidates.length > 0) {
        // 후보자들을 자동으로 등록 (테스트 지원)
        for (const validator of validatorCandidates) {
          if (!this.validators.has(validator)) {
            this.registerValidator(validator, 100);
          }
        }
        selectedValidator = this.pocConsensus.selectValidator(validatorCandidates);
      } else {
        // 등록된 검증자 중에서 선택
        const validators = Array.from(this.validators);
        if (validators.length === 0) {
          throw new Error('등록된 검증자가 없습니다');
        }
        selectedValidator = this.pocConsensus.selectValidator(validators);
      }

      // 처리할 트랜잭션 선택
      const transactionsToProcess = transactionsToMine.length > 0 
        ? transactionsToMine 
        : this.pendingTransactions.slice(0, 10);

      // 새 블록 생성
      const newBlock = this.createBlock(transactionsToProcess, selectedValidator);

      // 블록 체인에 추가
      const result = this.addBlock(newBlock);

      if (result.success) {
        console.log(`⛏️ 블록 #${result.block.index} 마이닝 완료`);
        
        // 마이닝 보상을 시스템 트랜잭션으로 체인에 추가 (Validator DAO DCA)
        const Transaction = require('./Transaction');
        const rewardTransaction = new Transaction(
          'did:baekya:system0000000000000000000000000000000000000000',
          selectedValidator,
          0.25,
          'B-Token',
          { type: 'validator_reward', blockIndex: result.block.index, description: '블록 생성 기여가치 (Validator DAO DCA)' }
        );
        
        // 보상 트랜잭션을 현재 블록에 추가
        result.block.transactions.push(rewardTransaction);
        result.block.merkleRoot = result.block.calculateMerkleRoot();
        result.block.hash = result.block.calculateHash();
        
        // 보상 트랜잭션이 추가된 블록을 다시 저장소에 반영
        this.updateStorageFromBlock(result.block);
        
        return result.block;
      } else {
        return result;
      }

    } catch (error) {
      console.error('❌ 블록 마이닝 실패:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // 검증자 등록 (통신주소 포함)
  registerValidator(validatorDID, contributionValue = 100, communicationAddress = null) {
    this.validators.set(validatorDID, {
      did: validatorDID,
      contributionValue,
      communicationAddress,
      status: 'active',
      registeredAt: Date.now(),
      totalRewards: 0,
      validatedBlocks: 0
    });
    this.pocConsensus.setContributionScore(validatorDID, contributionValue);
    
    console.log(`👤 검증자 등록됨: ${validatorDID.substring(0, 8)}...`);
    if (communicationAddress) {
      console.log(`📞 통신주소 연결: ${communicationAddress}`);
    }
    return { success: true };
  }

  // 잔액 조회 (보안 강화)
  getBalance(did, tokenType = 'B-Token') {
    // 초기화 확인
    if (!this.isInitialized || this.chain.length === 0) {
      console.warn('⚠️ 블록체인이 아직 초기화되지 않음');
      return 0;
    }
    
    // 시스템 계정 제한 (보안 강화)
    if (did.includes('system')) {
      // 시스템 계정의 무한 잔액을 제한
      return 999999999; // 9억 9천만으로 제한
    }

    // DID 형식 검증
    if (!this.isValidDID(did)) {
      console.warn(`잘못된 DID 형식: ${did}`);
      return 0;
    }

    // 초기 잔액 설정 (테스트 잔액이 있으면 사용 - 단, Founder 계정은 제외)
    let balance = 0;
    if (this.testBalances && !did.includes('founder')) {
      const key = `${did}-${tokenType}`;
      const testBalance = this.testBalances.get(key);
      if (testBalance !== undefined) {
        balance = testBalance;
      }
    }

    // 체인의 모든 트랜잭션 적용 (제네시스 블록 제외)
    for (const block of this.chain.slice(1)) {
      for (const transaction of block.transactions) {
        if (transaction.tokenType === tokenType) {
          if (transaction.fromDID === did) {
            balance -= transaction.amount;
          }
          if (transaction.toDID === did) {
            balance += transaction.amount;
          }
        }
      }
    }

    // 부동소수점 오류 방지를 위해 소수점 4자리까지 반올림
    return Math.round(Math.max(0, balance) * 10000) / 10000;
  }

  /**
   * DID 형식 검증 (보안)
   * @private
   */
  isValidDID(did) {
    const patterns = [
      /^did:baekya:[a-f0-9]{40,64}$/, // 표준 DID
      /^did:baekya:(system|genesis)[0-9a-f]{32,64}$/, // 시스템 DID
      /^did:baekya:test[a-f0-9]{40,48}$/, // 테스트 DID
      /^did:baekya:validator[0-9a-f]{40,64}$/, // 검증자 DID
      /^[a-f0-9]{64}$/ // SimpleAuth에서 생성하는 DID 형식 (접두사 없는 64자리 hex)
    ];
    
    return patterns.some(pattern => pattern.test(did));
  }

  // DID 레지스트리 설정 (보안)
  setDIDRegistry(didRegistry) {
    this.didRegistry = didRegistry;
  }

  // 트랜잭션 이력 조회
  getTransactionHistory(did, tokenType = null) {
    const transactions = [];

    for (const block of this.chain) {
      for (const transaction of block.transactions) {
        if (transaction.fromDID === did || transaction.toDID === did) {
          if (!tokenType || transaction.tokenType === tokenType) {
            transactions.push({
              ...transaction,
              from: transaction.fromDID,  // 테스트 호환성을 위해 추가
              to: transaction.toDID,      // 테스트 호환성을 위해 추가
              blockIndex: block.index,
              blockTimestamp: block.timestamp
            });
          }
        }
      }
    }

    return transactions.sort((a, b) => b.blockTimestamp - a.blockTimestamp);
  }

  // P2P 네트워크 이벤트 리스너 설정
  setupP2PListeners() {
    // 블록체인과 P2P 네트워크 상호 연결
    this.p2pNetwork.setBlockchain(this);

    // 새 블록 수신 시 처리
    this.p2pNetwork.on('newBlockReceived', (blockData) => {
      console.log('📦 새 블록 수신됨');
      this.handleReceivedBlock(blockData);
    });

    // 새 트랜잭션 수신 시 처리
    this.p2pNetwork.on('newTransactionReceived', (transactionData) => {
      console.log('💸 새 트랜잭션 수신됨');
      this.handleReceivedTransaction(transactionData);
    });

    // 동기화 데이터 수신 시 처리
    this.p2pNetwork.on('syncDataReceived', (syncData) => {
      console.log('🔄 동기화 데이터 수신됨');
      this.handleSyncData(syncData);
    });

    // 동기화 완료 시 처리
    this.p2pNetwork.on('syncCompleted', () => {
      console.log('✅ 네트워크 동기화 완료');
    });

    // 피어 연결/해제 시 로깅
    this.p2pNetwork.on('peerConnected', (peerInfo) => {
      console.log(`🤝 피어 연결됨: ${peerInfo.id.substring(0, 8)}...`);
    });

    this.p2pNetwork.on('peerDisconnected', (peerInfo) => {
      console.log(`👋 피어 연결 해제됨: ${peerInfo.id.substring(0, 8)}...`);
    });
  }

  // 수신된 블록 처리
  handleReceivedBlock(blockData) {
    try {
      // 블록 데이터를 Block 객체로 변환
      const Block = require('./Block');
      const receivedBlock = Block.fromJSON(blockData);

      // 블록 유효성 검증
      const latestBlock = this.getLatestBlock();
      if (receivedBlock.isValid(latestBlock)) {
        // 현재 체인보다 더 긴 체인인지 확인
        if (receivedBlock.index === latestBlock.index + 1) {
          // 다음 블록이므로 추가
          this.chain.push(receivedBlock);
          console.log(`✅ 새 블록 #${receivedBlock.index} 체인에 추가됨`);
          
          // 처리된 트랜잭션을 펜딩에서 제거
          this.removePendingTransactions(receivedBlock.transactions);
          
          return { success: true };
        } else if (receivedBlock.index > latestBlock.index + 1) {
          // 체인이 뒤처져 있으므로 동기화 요청
          console.log('⚠️ 체인이 뒤처져 있음 - 동기화 요청');
          this.p2pNetwork.requestSync();
          return { success: false, error: '동기화 필요' };
        }
      }
      
      return { success: false, error: '유효하지 않은 블록' };
      
    } catch (error) {
      console.error('❌ 수신된 블록 처리 실패:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 수신된 트랜잭션 처리
  handleReceivedTransaction(transactionData) {
    try {
      const Transaction = require('./Transaction');
      const receivedTransaction = Transaction.fromJSON ? 
        Transaction.fromJSON(transactionData) : transactionData;

      // 이미 처리된 트랜잭션인지 확인
      const isAlreadyProcessed = this.pendingTransactions.some(tx => 
        tx.hash === receivedTransaction.hash
      );

      if (!isAlreadyProcessed) {
        // 트랜잭션 유효성 검증 및 추가
        const result = this.addTransaction(receivedTransaction);
        if (result.success) {
          console.log(`✅ 네트워크 트랜잭션 추가됨: ${receivedTransaction.hash?.substring(0, 16)}...`);
        }
        return result;
      }
      
      return { success: false, error: '이미 처리된 트랜잭션' };
      
    } catch (error) {
      console.error('❌ 수신된 트랜잭션 처리 실패:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 동기화 데이터 처리
  handleSyncData(syncData) {
    try {
      if (syncData.blocks && syncData.blocks.length > 0) {
        // 더 긴 체인인지 확인
        if (syncData.chainLength > this.chain.length) {
          console.log(`🔄 더 긴 체인 발견: ${syncData.chainLength} vs ${this.chain.length}`);
          
          // 체인 검증
          const Block = require('./Block');
          const newChain = syncData.blocks.map(blockData => 
            Block.fromJSON ? Block.fromJSON(blockData) : blockData
          );

          if (this.isValidChain(newChain)) {
            // 더 긴 유효한 체인으로 교체
            this.chain = newChain;
            console.log('✅ 체인 동기화 완료');
            this.p2pNetwork.completSync();
            return { success: true };
          }
        }
      }
      
      return { success: false, error: '동기화할 데이터 없음' };
      
    } catch (error) {
      console.error('❌ 동기화 데이터 처리 실패:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 블록체인 상태 조회
  getBlockchainStatus() {
    return {
      chainLength: this.chain.length,
      difficulty: this.difficulty,
      pendingTransactions: this.pendingTransactions.length,
      validators: this.validators.size,
      lastBlockHash: this.getLatestBlock().hash,
      networkStatus: this.p2pNetwork.getNetworkStatus(),
      contributionStats: this.pocConsensus.getContributionStats()
    };
  }

  // 블록체인 통계
  getStats() {
    let totalTransactions = 0;
    let totalBTokens = 0;
    let totalPTokens = 0;

    for (const block of this.chain) {
      totalTransactions += block.transactions.length;
      
      for (const tx of block.transactions) {
        if (tx.tokenType === 'B-Token') {
          totalBTokens += tx.amount;
        } else if (tx.tokenType === 'P-Token') {
          totalPTokens += tx.amount;
        }
      }
    }

    return {
      totalBlocks: this.chain.length,
      totalTransactions,
      totalBTokens,
      totalPTokens,
      avgTransactionsPerBlock: totalTransactions / this.chain.length,
      chainSize: JSON.stringify(this.chain).length, // 대략적인 크기
      uptime: Date.now() - this.chain[0].timestamp
    };
  }

  // P2P 네트워크 시작
  startNetwork(port = 3000) {
    return this.p2pNetwork.start(port);
  }

  // 블록체인 데이터 내보내기
  exportChain() {
    return {
      chain: this.chain.map(block => block.toJSON()),
      difficulty: this.difficulty,
      pendingTransactions: this.pendingTransactions.map(tx => tx.toJSON()),
      validators: Array.from(this.validators),
      consensus: this.pocConsensus.toJSON(),
      timestamp: Date.now()
    };
  }

  // 블록체인 데이터 가져오기
  importChain(chainData) {
    try {
      // 데이터 검증
      if (!chainData.chain || !Array.isArray(chainData.chain)) {
        throw new Error('유효하지 않은 체인 데이터');
      }

      // 체인 복원
      this.chain = chainData.chain.map(blockData => Block.fromJSON(blockData));
      this.difficulty = chainData.difficulty || 2;
      this.pendingTransactions = (chainData.pendingTransactions || [])
        .map(txData => Transaction.fromJSON(txData));
      this.validators = new Set(chainData.validators || []);
      
      if (chainData.consensus) {
        this.pocConsensus = PoCConsensus.fromJSON(chainData.consensus);
      }

      // 체인 유효성 검증
      if (!this.isChainValid()) {
        throw new Error('가져온 체인이 유효하지 않습니다');
      }

      console.log('✅ 블록체인 데이터 가져오기 완료');
      return { success: true, chainLength: this.chain.length };

    } catch (error) {
      console.error('❌ 블록체인 데이터 가져오기 실패:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 네트워크에서 블록 수신
  receiveBlock(block) {
    console.log('📦 네트워크에서 블록 수신');
    return this.addBlock(block);
  }

  // 체인 충돌 해결 (가장 긴 유효한 체인 선택)
  resolveConflicts(chains) {
    let longestChain = this.chain;
    let hasConflicts = false;

    for (const chain of chains) {
      if (Array.isArray(chain) && chain.length > longestChain.length) {
        // 체인 유효성 검증
        if (this.isValidChain(chain)) {
          longestChain = chain;
          hasConflicts = true;
        }
      }
    }

    if (hasConflicts) {
      this.chain = longestChain;
      console.log('🔄 더 긴 유효한 체인으로 교체됨');
      return { success: true, newChainLength: this.chain.length };
    }

    return { success: false, error: '더 긴 유효한 체인이 없습니다' };
  }

  // 체인 유효성 검증 (외부 체인용)
  isValidChain(chain) {
    if (!Array.isArray(chain) || chain.length === 0) return false;

    // 제네시스 블록 검증
    if (chain[0].index !== 0 || chain[0].previousHash !== '0') {
      return false;
    }

    // 각 블록 검증
    for (let i = 1; i < chain.length; i++) {
      const currentBlock = chain[i];
      const previousBlock = chain[i - 1];

      if (!currentBlock.isValid || !currentBlock.isValid(previousBlock)) {
        return false;
      }
    }

    return true;
  }

  // 계정 잔액 설정 (테스트용)
  setBalance(did, balance, tokenType = 'B-Token') {
    // 실제 구현에서는 제네시스 트랜잭션이나 시스템 트랜잭션으로 처리
    if (!this.testBalances) {
      this.testBalances = new Map();
    }
    
    const key = `${did}-${tokenType}`;
    this.testBalances.set(key, balance);
    
    console.log(`💰 테스트 잔액 설정: ${did.substring(0, 8)}... = ${balance} ${tokenType}`);
    return { success: true };
  }

  // 잔액 업데이트 (테스트용) - 체인 기반으로 재계산하지 않고 초기값 유지
  updateBalances() {
    // 이 메서드는 테스트에서 호출되지만 실제로는 아무것도 하지 않음
    // 잔액은 getBalance에서 실시간으로 계산됨
    return { success: true };
  }

  // 체인에서 실제 잔액 계산 (헬퍼 메서드)
  calculateChainBalance(did, tokenType = 'B-Token') {
    // 시스템 계정은 무한대
    if (did.includes('system')) {
      return Number.MAX_SAFE_INTEGER;
    }

    // 초기 테스트 잔액 가져오기 (체인 트랜잭션 적용 전 기준점 - Founder 계정 제외)
    let balance = 0;
    if (this.testBalances && !did.includes('founder')) {
      const key = `${did}-${tokenType}`;
      const initialBalance = this.testBalances.get(key);
      if (initialBalance !== undefined) {
        balance = initialBalance;
      }
    }

    // 체인의 모든 트랜잭션 적용 (제네시스 블록 제외)
    for (const block of this.chain.slice(1)) {
      for (const transaction of block.transactions) {
        if (transaction.tokenType === tokenType) {
          if (transaction.fromDID === did) {
            balance -= transaction.amount;
          }
          if (transaction.toDID === did) {
            balance += transaction.amount;
          }
        }
      }
    }

    // 부동소수점 오류 방지를 위해 소수점 4자리까지 반올림
    return Math.round(Math.max(0, balance) * 10000) / 10000;
  }

  // 채굴 난이도 조정
  adjustDifficulty() {
    const recentBlocks = this.chain.slice(-10); // 최근 10개 블록
    
    if (recentBlocks.length < 2) return;

    const avgTime = recentBlocks.reduce((sum, block, index) => {
      if (index === 0) return sum;
      return sum + (block.timestamp - recentBlocks[index - 1].timestamp);
    }, 0) / (recentBlocks.length - 1);

    const targetTime = 10000; // 10초 목표

    if (avgTime < targetTime / 2) {
      this.difficulty += 1;
      console.log(`⬆️ 채굴 난이도 증가: ${this.difficulty}`);
    } else if (avgTime > targetTime * 2) {
      this.difficulty = Math.max(1, this.difficulty - 1);
      console.log(`⬇️ 채굴 난이도 감소: ${this.difficulty}`);
    }
  }

  // 외부 릴레이에서 전파된 블록 추가 (검증 후)
  addExternalBlock(blockData) {
    try {
      // 블록 데이터 유효성 검사
      if (!blockData || !blockData.index || !blockData.hash || !blockData.previousHash) {
        return { success: false, error: '블록 데이터 불완전' };
      }

      // 이미 존재하는 블록인지 확인
      const existingBlock = this.chain.find(block => block.index === blockData.index);
      if (existingBlock) {
        if (existingBlock.hash === blockData.hash) {
          return { success: true, message: '이미 존재하는 블록 (중복 방지)' };
        } else {
          return { success: false, error: '같은 인덱스의 다른 블록이 이미 존재' };
        }
      }

      // 현재 체인보다 뒤에 있는 블록인지 확인
      const latestBlock = this.getLatestBlock();
      if (blockData.index <= latestBlock.index) {
        return { success: false, error: '이미 처리된 블록' };
      }

      // 블록 무결성 검증
      const block = new Block();
      Object.assign(block, blockData);
      
      // 트랜잭션 객체 복원
      if (blockData.transactions) {
        block.transactions = blockData.transactions.map(txData => {
          const tx = new Transaction();
          Object.assign(tx, txData);
          return tx;
        });
      }

      // 해시 검증
      const calculatedHash = block.calculateHash();
      if (calculatedHash !== block.hash) {
        return { success: false, error: '블록 해시 검증 실패' };
      }

      // 이전 블록과의 연결 검증
      if (block.previousHash !== latestBlock.hash) {
        // 연속되지 않은 블록인 경우 - 체인 동기화 필요할 수 있음
        console.warn(`⚠️ 블록 체인 불연속 감지: 예상 ${latestBlock.hash}, 실제 ${block.previousHash}`);
        
        // 간단한 처리: 인덱스가 바로 다음이 아니면 거부
        if (block.index !== latestBlock.index + 1) {
          return { success: false, error: '블록 순서 불일치 - 체인 동기화 필요' };
        }
      }

      // 트랜잭션 검증
      for (const transaction of block.transactions) {
        // Transaction 객체로 복원하여 검증
        const Transaction = require('./Transaction');
        let txObj = transaction;
        
        // 일반 객체인 경우 Transaction 객체로 변환
        if (!(transaction instanceof Transaction)) {
          txObj = Transaction.fromJSON ? Transaction.fromJSON(transaction) : Object.assign(new Transaction(), transaction);
        }
        
        if (!txObj.isValid(this.didRegistry)) {
          return { success: false, error: '유효하지 않은 트랜잭션 포함' };
        }
      }

      // 블록을 체인에 추가
      this.chain.push(block);

      // 트랜잭션 처리 (잔액 업데이트 등)
      this.processBlockTransactions(block);

      // 저장소에 저장
      if (this.dataStorage) {
        this.dataStorage.saveBlockchain(this.chain);
      }

      console.log(`✅ 외부 블록 #${block.index} 체인에 추가 완료 (${block.transactions.length}개 트랜잭션)`);
      
      return { 
        success: true, 
        block: block,
        message: `블록 #${block.index} 추가 완료`
      };

    } catch (error) {
      console.error('❌ 외부 블록 추가 실패:', error.message);
      return { success: false, error: error.message };
    }
  }

  // 블록의 트랜잭션들을 처리하여 상태 업데이트
  processBlockTransactions(block) {
    try {
      for (const transaction of block.transactions) {
        // 잔액 검증은 이미 했으므로 바로 적용
        this.applyTransaction(transaction);
        
        // 거버넌스 제안 생성 트랜잭션 처리
        if (transaction.data?.type === 'governance_proposal_creation') {
          this.processGovernanceProposalTransaction(transaction);
        }
      }
    } catch (error) {
      console.error('❌ 블록 트랜잭션 처리 실패:', error.message);
    }
  }

  // 거버넌스 제안 트랜잭션 처리
  processGovernanceProposalTransaction(transaction) {
    try {
      if (this.dataStorage) {
        const proposalData = transaction.data;
        
        // 사용자명 조회 (기존 시스템과 동일한 방식)
        let username = 'Unknown';
        try {
          // 먼저 storage에서 사용자 정보 조회
          const userInfo = this.dataStorage.getUserInfo(transaction.fromDID);
          if (userInfo) {
            // name을 우선 사용, 없으면 username 사용
            username = userInfo.name || userInfo.username || 'Unknown';
          } else {
            // SimpleAuth에서 DID 정보 조회 시도
            if (this.authSystem) {
              const didInfo = this.authSystem.getDIDInfo(transaction.fromDID);
              if (didInfo.success && didInfo.didData) {
                // name을 우선 사용, 없으면 username 사용
                username = didInfo.didData.name || didInfo.didData.username || 'Unknown';
              }
            }
          }
          console.log(`👤 사용자명 조회 결과: ${transaction.fromDID} → ${username}`);
        } catch (userError) {
          console.warn(`⚠️ 사용자명 조회 실패: ${userError.message}`);
        }
        
        // 기존 거버넌스 시스템 형식에 맞춰 제안 객체 생성
        const proposal = {
          id: proposalData.proposalId,
          title: proposalData.title,
          description: proposalData.description,
          label: proposalData.label || 'governance',
          author: {
            did: transaction.fromDID,
            username: username
          },
          authorDID: transaction.fromDID, // 호환성을 위해 유지
          status: 'active',
          votes: { yes: 0, no: 0, abstain: 0 },
          voters: [],
          createdAt: transaction.timestamp || Date.now(),
          lastUpdated: transaction.timestamp || Date.now(),
          hasStructure: proposalData.hasStructure || false,
          repositoryUrl: proposalData.repositoryUrl || '',
          cost: 5, // 기본 비용
          reports: []
        };
        
        // 기존 거버넌스 시스템 저장 방식 사용
        this.dataStorage.addGovernanceProposal(proposal);
        
        console.log(`✅ 거버넌스 제안 트랜잭션 처리: ${proposalData.title} (ID: ${proposalData.proposalId}) by ${username}`);
      }
    } catch (error) {
      console.error('❌ 거버넌스 제안 트랜잭션 처리 실패:', error.message);
    }
  }

  // 트랜잭션을 실제 상태에 적용
  applyTransaction(transaction) {
    // 시스템 트랜잭션이 아닌 경우에만 송신자 잔액 차감
    if (transaction.fromDID && !transaction.fromDID.includes('system') && !transaction.fromDID.includes('genesis')) {
      // 송신자 잔액 차감
      const fromBalance = this.getBalance(transaction.fromDID, transaction.tokenType);
      this.setBalance(transaction.fromDID, transaction.tokenType, fromBalance - transaction.amount);
    }
    
    // 수신자 잔액 증가 (시스템 계정이 아닌 경우)
    if (transaction.toDID && !transaction.toDID.includes('system')) {
      const toBalance = this.getBalance(transaction.toDID, transaction.tokenType);
      this.setBalance(transaction.toDID, transaction.tokenType, toBalance + transaction.amount);
    }
  }

  // 모든 트랜잭션 조회 (레포지토리용)
  getAllTransactions() {
    const allTransactions = [];
    
    // 체인의 모든 블록에서 트랜잭션 수집
    for (const block of this.chain) {
      if (block.transactions && Array.isArray(block.transactions)) {
        allTransactions.push(...block.transactions);
      }
    }
    
    // 대기 중인 트랜잭션도 포함
    allTransactions.push(...this.pendingTransactions);
    
    return allTransactions;
  }
}

module.exports = BlockchainCore; 
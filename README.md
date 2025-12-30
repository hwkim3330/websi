# VelocityDRIVE-SP YANG Browser

WebSerial 기반 YANG 데이터 브라우저 - Microchip LAN9662/LAN9692 VelocityDRIVE-SP TSN 스위치용

## Live Demo

| Version | URL | Description |
|---------|-----|-------------|
| **Browser** | [hwkim3330.github.io/websi/](https://hwkim3330.github.io/websi/) | 읽기 전용 YANG 브라우저 |
| **Editor** | [hwkim3330.github.io/websi/editor.html](https://hwkim3330.github.io/websi/editor.html) | 편집 가능 (iPatch 지원) |
| **TSN Config** | [hwkim3330.github.io/websi/tsn.html](https://hwkim3330.github.io/websi/tsn.html) | TSN 설정 (TAS/CBS/PTP) |
| **Mobile** | [hwkim3330.github.io/websi/mobile.html](https://hwkim3330.github.io/websi/mobile.html) | 모바일 최적화 버전 |

## Features

- **WebSerial API**: 서버 없이 브라우저에서 직접 시리얼 통신
- **MUP1 Protocol**: Microchip UART Protocol #1 구현
- **CoAP/CORECONF**: RFC 7252 CoAP + RFC 9254 CBOR 인코딩
- **Block2 Transfer**: RFC 7959 블록 단위 전송 (대용량 응답 처리)
- **Delta-SID Decoding**: YANG SID를 사람이 읽을 수 있는 이름으로 변환
- **Tree View**: Registry Editor 스타일 계층적 데이터 탐색

## Supported Boards

| Board | Chip | Ports |
|-------|------|-------|
| LAN9662 | VSC7514 | 2x 1GbE |
| LAN9692 | VSC7512 | 4x 1GbE |

## Quick Start

1. USB로 보드 연결 (시리얼 포트로 인식됨)
2. https://hwkim3330.github.io/websi/ 접속
3. "연결" 버튼 클릭
4. 시리얼 포트 선택 (보통 `/dev/ttyACM0` 또는 `COM3`)
5. 보드 ANNOUNCE 후 자동으로 YANG 데이터 로드

## YANG Modules

다음 YANG 모듈의 데이터를 조회합니다:

| Module | SID | Description |
|--------|-----|-------------|
| ietf-system:system-state | 19020 | 시스템 상태 (플랫폼 정보) |
| ietf-system:system | 19017 | 시스템 설정 |
| ietf-interfaces:interfaces | 2005 | 네트워크 인터페이스 |
| ieee802-dot1q-bridge:bridges | 7025 | 브리지 설정 |
| ieee1588-ptp:ptp | 15076 | PTP 동기화 |
| ieee802-dot1ab-lldp:lldp | 11001 | LLDP 프로토콜 |
| ietf-routing:routing | 12010 | 라우팅 |
| ietf-hardware:hardware | 31054 | 하드웨어 컴포넌트 |
| ieee802-dot1cb-stream-identification | 24005 | FRER 스트림 |
| mchp-velocitysp-acl:acl | 39008 | ACL 설정 |

## TSN Features

VelocityDRIVE-SP는 다음 TSN 표준을 지원합니다:

- **IEEE 802.1Qbv (TAS)**: Time-Aware Shaper - 시간 기반 트래픽 스케줄링
- **IEEE 802.1Qav (CBS)**: Credit-Based Shaper - 대역폭 예약
- **IEEE 802.1Qbu/802.3br**: Frame Preemption - 프레임 선점
- **IEEE 802.1CB (FRER)**: Frame Replication and Elimination - 이중화
- **IEEE 1588 (PTP)**: Precision Time Protocol - 정밀 시간 동기화

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Web Browser                          │
├─────────────────────────────────────────────────────────┤
│  app.js          │  webserial.js      │  cbor.min.js   │
│  - Tree View     │  - WebSerial API   │  - CBOR codec  │
│  - SID Decode    │  - MUP1 Protocol   │                │
│  - UI Control    │  - CoAP Client     │                │
│                  │  - Block2 Support  │                │
├─────────────────────────────────────────────────────────┤
│                    WebSerial API                        │
└─────────────────────────────────────────────────────────┘
                           │
                           │ USB Serial
                           ▼
┌─────────────────────────────────────────────────────────┐
│              LAN9662/LAN9692 Board                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ MUP1 Frame  │→ │ CoAP Server │→ │ YANG Store  │     │
│  │ Handler     │  │ (CORECONF)  │  │             │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
└─────────────────────────────────────────────────────────┘
```

## Protocol Stack

### MUP1 Frame Format
```
┌─────┬──────┬─────────────┬─────┬──────────┐
│ SOF │ Type │   Payload   │ EOF │ Checksum │
│ 0x3E│ 1B   │   Variable  │ 0x3C│   1B     │
└─────┴──────┴─────────────┴─────┴──────────┘
```

### CoAP Message
```
┌────────┬─────────┬─────────┬─────────────┐
│ Header │ Token   │ Options │ CBOR Payload│
│ 4B     │ 0-8B    │ Variable│ Variable    │
└────────┴─────────┴─────────┴─────────────┘
```

## Files

```
websi/
├── index.html          # 읽기 전용 YANG 브라우저
├── editor.html         # 편집 가능 버전 (iPatch)
├── tsn.html            # TSN 설정 (TAS/CBS/PTP)
├── mobile.html         # 모바일 최적화 버전
├── css/
│   └── style.css       # VS Code 다크 테마
├── js/
│   ├── app.js          # 브라우저 앱 로직
│   ├── editor.js       # 에디터 앱 로직
│   ├── tsn.js          # TSN 설정 로직 (iPatch)
│   ├── mobile.js       # 모바일 앱 로직
│   ├── webserial.js    # WebSerial + MUP1 + CoAP
│   ├── coap.js         # CoAP 프로토콜
│   ├── cbor.min.js     # CBOR 인코더/디코더
│   └── catalogs/       # YANG SID 카탈로그 (12개)
│       ├── index.json
│       └── *.json
└── README.md
```

## Browser Requirements

- Chrome 89+ 또는 Edge 89+ (WebSerial API 지원)
- HTTPS 또는 localhost (WebSerial 보안 요구사항)

## Development

로컬에서 실행:
```bash
# Python 3
python3 -m http.server 8080

# Node.js
npx serve .
```

브라우저에서 `http://localhost:8080` 접속

## License

MIT License

## References

- [Microchip VelocityDRIVE-SP](https://www.microchip.com/en-us/development-tool/velocitydrive-sp)
- [YANG SID Catalog](https://microchip-ung.github.io/velocitydrivesp-documentation/)
- [RFC 7252 - CoAP](https://datatracker.ietf.org/doc/html/rfc7252)
- [RFC 9254 - CBOR Encoding of Data Modeled with YANG](https://datatracker.ietf.org/doc/html/rfc9254)
- [RFC 7959 - Block-Wise Transfers in CoAP](https://datatracker.ietf.org/doc/html/rfc7959)

# Upbit → Discord Alert (Slash Commands Version)

Replit에서 실행하면, 디스코드 **슬래시 명령**으로 설정을 바꿀 수 있어요.

## 환경변수 (Replit → Tools → Secrets)
- `DISCORD_WEBHOOK` : 디스코드 웹훅 URL (알림 전송용, 필수)
- `DISCORD_TOKEN` : 디스코드 봇 토큰 (슬래시 명령용, 필수)
- `DISCORD_GUILD_ID` : 명령을 등록할 서버 ID (필수)

선택(초기값)
- `MARKET`, `AVERAGE`, `UP_PCT`, `DOWN_PCT`, `COOLDOWN_MIN`

## 사용법
1. Discord 개발자 포털에서 앱/봇 생성 → 토큰 복사
2. OAuth2 URL Generator: scopes `bot`, `applications.commands` 체크 → 서버에 초대
3. Replit Secrets에 환경변수 저장 후 실행
4. 디스코드에서 `/status`, `/set`, `/test` 사용

## 저장
- 설정은 `config.json`으로 저장되어, 재시작에도 유지됩니다.

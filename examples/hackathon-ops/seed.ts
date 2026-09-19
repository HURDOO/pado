import { createApi } from './api.ts';
const api = createApi(process.env.DESK_DB || 'data/desk.sqlite');
try {
  api.seed();
  console.log('가상 예시 팀·질문을 추가했습니다. 기존 데이터는 변경하지 않습니다.');
} finally {
  api.close();
}

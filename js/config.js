/* ============================================================
   config.js —— 静态版写死配置（可公开）
   地址不敏感可写死；令牌截断：除最后 8 位外全部写死于此，
   使用者只需输入 8 位哈希值码即可拼合完整令牌连接云库。
   ============================================================ */

/** Turso 数据库地址（公开信息，泄露无害） */
export const DB_URL = 'libsql://mfsckb-seetion.aws-ap-northeast-1.turso.io';

/** 令牌前缀 = 完整令牌去掉最后 8 位 */
export const TOKEN_PREFIX =
  'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.' +
  'eyJhIjoicnciLCJpYXQiOjE3OTExOTU1NzcsImlkIjoiMDFhMTBiOTAtNzYwMS03YjY1LWIyNmQtZGQyNzg5OTM0ZTI3Iiwia2lkIjoiNW1rS0otOGlaZFpIWjBzR095b3o4NE5fTkdseUhIbXhaUE9RSm11c1NmUSIsInJpZCI6IjAzOTA0NDBhLTlmYWUtNDQ2MC1iMzUyLTFmMjE4NWEzZGMyMyJ9.' +
  'uajRl8RF_7IaCr_ADCjHvtAoTl7Cj7Vjkm0YcrUanhMkXsuYQWsrJY85zpy7IWKmmA51CBzHVqiFT_';

/** 拼合完整令牌：前缀 + 使用者输入的 8 位哈希值码 */
export function buildToken(suffix) {
  return TOKEN_PREFIX + String(suffix || '').trim();
}
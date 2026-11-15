/** Desktop-only icons; these never create content buckets or account platforms. */
export const DECORATIVE_APPS = [
  ['safari', 'Safari', '#1687ed'],
  ['mail', '邮件', '#1687ed'],
  ['calendar', '日历', '#ffffff'],
  ['weather', '天气', '#329de7'],
  ['clock', '时钟', '#171717'],
  ['maps', '地图', '#71bd79'],
  ['calculator', '计算器', '#333333'],
  ['app-store', 'App Store', '#1687ed'],
  ['camera', '相机', '#bfc3ca'],
  ['files', '文件', '#ffffff'],
  ['voice-memos', '语音备忘录', '#171717'],
  ['reminders', '提醒事项', '#ffffff'],
].map(([key, name, accent]) => ({ id: `deco-${key}`, name, iconKey: key, accent }))

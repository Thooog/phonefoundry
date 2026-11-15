export const HOME_WEATHER = ['晴', '多云', '阴', '雨', '雷雨', '雪']
export function homeWeather(value) {
  if (HOME_WEATHER.includes(value)) return value
  if (typeof value !== 'string') return '晴'
  return ['雷雨', '雪', '雨', '多云', '阴'].find(label => value.includes(label)) ?? '晴'
}

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

const shanghaiDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const shanghaiTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatShanghaiDateTime(value: Date | string): string {
  return shanghaiDateTimeFormatter.format(new Date(value));
}

export function formatShanghaiTime(value: Date | string): string {
  return shanghaiTimeFormatter.format(new Date(value));
}

export function getShanghaiDayRange(date: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('日期必须使用 YYYY-MM-DD 格式');
  }
  return {
    start: new Date(`${date}T00:00:00.000+08:00`),
    end: new Date(`${date}T23:59:59.999+08:00`),
  };
}

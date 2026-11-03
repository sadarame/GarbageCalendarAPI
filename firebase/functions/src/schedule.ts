import { z } from "zod";
const dayMs = 86400000;
const weekdays = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
const ordinals = ["第一", "第二", "第三", "第四", "第五"];
export const civilDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(v + "T00:00:00Z");
  return !isNaN(+d) && d.toISOString().slice(0, 10) === v;
});
const base = {
  validFrom: civilDay.optional(),
  validTo: civilDay.optional(),
  garbageType: z.string().trim().min(1).max(80),
  iconType: z.enum(["燃えるゴミ", "燃えないゴミ", "プラスチック", "ビン・カン", "ペットボトル", "古紙", "ダンボール", "資源ゴミ", "粗大ごみ", "危険・有害", "繊維", "資源（共通）"]).optional(),
  excludedDates: z.array(civilDay).max(100).optional(),
  additionalDates: z.array(civilDay).max(100).optional(),
};
const weekday = z.string().refine(v => weekdays.includes(v));
export const ruleSchema = z.discriminatedUnion("schedule", [
  z.object({ ...base, schedule: z.literal("指定日のみ"), specificDates: z.array(civilDay).min(1).max(366) }),
  z.object({ ...base, schedule: z.literal("毎週"), yobi: weekday }),
  z.object({ ...base, schedule: z.literal("毎月"), day: z.number().int().min(1).max(31) }),
  z.object({ ...base, schedule: z.literal("第○曜日"), yobi: weekday, weekOfMonth: z.enum(["第一", "第二", "第三", "第四", "第五"]) }),
  z.object({ ...base, schedule: z.literal("隔週"), yobi: weekday, strDate: civilDay, freqWeek: z.enum(["二週に一回", "三週に一回", "四週に一回"]) }),
]);
export const settingsSchema = z.object({
  enabled: z.boolean(), previousDay: z.boolean(),
  hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59),
  timeZone: z.literal("Asia/Tokyo"),
});
export type Rule = z.infer<typeof ruleSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export interface Occurrence { fireAt: number; collectionDate: string; types: string[] }
export function matches(rule: Rule, day: string): boolean {
  if (rule.validFrom && day < rule.validFrom || rule.validTo && day > rule.validTo) return false;
  if (rule.schedule === "指定日のみ") return rule.specificDates.includes(day);
  if (rule.excludedDates?.includes(day)) return false;
  if (rule.additionalDates?.includes(day)) return true;
  const d = new Date(day + "T00:00:00Z");
  switch (rule.schedule) {
    case "毎週": return weekdays[d.getUTCDay()] === rule.yobi;
    case "毎月": return d.getUTCDate() === rule.day;
    case "第○曜日": return weekdays[d.getUTCDay()] === rule.yobi && Math.floor((d.getUTCDate()-1)/7) === ordinals.indexOf(rule.weekOfMonth);
    case "隔週": {
      if (weekdays[d.getUTCDay()] !== rule.yobi) return false;
      const anchor = new Date(rule.strDate + "T00:00:00Z");
      const shift = (d.getUTCDay()-anchor.getUTCDay()+7)%7;
      const days = (+d - +anchor)/dayMs - shift;
      const interval = {"二週に一回":2,"三週に一回":3,"四週に一回":4}[rule.freqWeek];
      return days >= 0 && days % (interval*7) === 0;
    }
  }
}
export function nextOccurrence(rules: Rule[], settings: Settings, after: number): Occurrence | null {
  if (!settings.enabled) return null;
  const start = new Date(after + 9*3600000).toISOString().slice(0,10);
  const startMs = Date.parse(start + "T00:00:00Z");
  for (let i=0;i<=366;i++) {
    const collectionDate = new Date(startMs+i*dayMs).toISOString().slice(0,10);
    const fireAt = Date.parse(collectionDate + "T00:00:00+09:00") +
      (settings.hour*60+settings.minute)*60000 - (settings.previousDay ? dayMs : 0);
    if (fireAt <= after) continue;
    const types = [...new Set(rules.filter(r => matches(r, collectionDate)).map(r => r.garbageType))].sort();
    if (types.length) return {fireAt, collectionDate, types};
  }
  return null;
}

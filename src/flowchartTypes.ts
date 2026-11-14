export const FLOW_SHAPES = [
  "terminator", "process", "decision", "data", "document", "multipleDocuments",
  "database", "storage", "internalStorage", "preparation", "manualInput",
  "manualOperation", "predefinedProcess", "delay", "display", "connector",
  "offPageConnector", "merge", "extract", "or",
] as const;

export type FlowShape = (typeof FLOW_SHAPES)[number];

export const shapeLabels: Record<FlowShape, string> = {
  terminator: "بداية / نهاية",
  process: "عملية",
  decision: "قرار",
  data: "إدخال / إخراج",
  document: "مستند",
  multipleDocuments: "مستندات متعددة",
  database: "قاعدة بيانات",
  storage: "تخزين بيانات",
  internalStorage: "تخزين داخلي",
  preparation: "تهيئة",
  manualInput: "إدخال يدوي",
  manualOperation: "عملية يدوية",
  predefinedProcess: "عملية فرعية",
  delay: "تأخير",
  display: "عرض",
  connector: "موصل",
  offPageConnector: "موصل خارج الصفحة",
  merge: "دمج",
  extract: "استخراج",
  or: "أو",
};
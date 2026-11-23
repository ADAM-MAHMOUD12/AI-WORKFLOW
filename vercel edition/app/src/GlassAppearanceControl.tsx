import { useEffect, useRef, useState } from "react";
import { ImagePlus, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import "./GlassAppearanceControl.css";

type GlassSettings = {
  blur: number;
  opacity: number;
  saturation: number;
  tint: string;
  wallpaper: string;
};

const STORAGE_KEY = "taskflow-glass-appearance";
const DEFAULTS: GlassSettings = {
  blur: 5,
  opacity: 34,
  saturation: 120,
  tint: "#c4c0cf",
  wallpaper: "",
};

function isGlassSettings(value: unknown): value is GlassSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<GlassSettings>;
  return typeof settings.blur === "number" && settings.blur >= 0 && settings.blur <= 36
    && typeof settings.opacity === "number" && settings.opacity >= 10 && settings.opacity <= 92
    && typeof settings.saturation === "number" && settings.saturation >= 60 && settings.saturation <= 180
    && typeof settings.tint === "string"
    && /^#[\da-f]{6}$/i.test(settings.tint)
    && typeof settings.wallpaper === "string"
    && (settings.wallpaper === "" || settings.wallpaper.startsWith("data:image/"));
}

function readSavedSettings(): { settings: GlassSettings; error: string } {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return { settings: DEFAULTS, error: "" };
    const parsed: unknown = JSON.parse(saved);
    if (!isGlassSettings(parsed)) throw new Error("إعدادات الزجاج المحفوظة غير صالحة.");
    return { settings: parsed, error: "" };
  } catch (reason) {
    return {
      settings: DEFAULTS,
      error: reason instanceof Error ? reason.message : String(reason),
    };
  }
}

function wallpaperDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("تعذّر تجهيز الصورة للخلفية."));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("تعذّر ضغط الصورة للخلفية."));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error("تعذّر حفظ الصورة للخلفية."));
        reader.onerror = () => reject(new Error("تعذّر قراءة الصورة المختارة."));
        reader.readAsDataURL(blob);
      }, "image/webp", 0.78);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("تعذّر فتح الصورة المختارة."));
    };
    image.src = objectUrl;
  });
}

export default function GlassAppearanceControl({
  language,
  placement,
}: {
  language: "ar" | "en";
  placement: "auth" | "toolbar";
}) {
  const [initial] = useState(readSavedSettings);
  const [settings, setSettings] = useState(initial.settings);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(initial.error);
  const controlRef = useRef<HTMLDivElement>(null);
  const isArabic = language === "ar";

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--glass-blur", `${settings.blur}px`);
    root.style.setProperty("--glass-opacity", `${settings.opacity}%`);
    root.style.setProperty("--glass-saturation", `${settings.saturation}%`);
    root.style.setProperty("--glass-tint", settings.tint);
    root.style.setProperty(
      "--taskflow-wallpaper-image",
      settings.wallpaper ? `url("${settings.wallpaper}")` : "none",
    );
  }, [settings]);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function closeOnOutsideClick(event: PointerEvent) {
      if (controlRef.current && !controlRef.current.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [open]);

  function update(next: GlassSettings) {
    setSettings(next);
    setError("");
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function selectWallpaper(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(isArabic ? "اختر ملف صورة صالحًا." : "Choose a valid image file.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError(isArabic ? "حجم الصورة يتجاوز 12 ميغابايت." : "The image exceeds 12 MB.");
      return;
    }
    try {
      const wallpaper = await wallpaperDataUrl(file);
      update({ ...settings, wallpaper });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const copy = isArabic
    ? {
        title: "إعدادات الزجاج",
        blur: "التمويه",
        opacity: "الشفافية",
        saturation: "التشبّع",
        tint: "لون الزجاج",
        wallpaper: "خلفية مخصصة",
        upload: "اختر صورة",
        remove: "إزالة الخلفية",
        reset: "إعادة الضبط",
        close: "إغلاق الإعدادات",
        open: "تخصيص مظهر الزجاج",
      }
    : {
        title: "Glass settings",
        blur: "Blur",
        opacity: "Opacity",
        saturation: "Saturation",
        tint: "Glass tint",
        wallpaper: "Custom wallpaper",
        upload: "Choose image",
        remove: "Remove wallpaper",
        reset: "Reset settings",
        close: "Close appearance settings",
        open: "Customize glass appearance",
      };

  return (
    <div className={`glass-control glass-control-${placement}`} ref={controlRef}>
      <button
        type="button"
        className="glass-control-trigger"
        aria-label={copy.open}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal size={17} aria-hidden="true" />
        {placement === "auth" && <span>{copy.title}</span>}
      </button>
      {open && (
        <section className="glass-control-panel" role="dialog" aria-modal="false" aria-labelledby="glass-control-title">
          <header>
            <h2 id="glass-control-title"><SlidersHorizontal size={17} aria-hidden="true" />{copy.title}</h2>
            <button type="button" className="glass-control-close" onClick={() => setOpen(false)} aria-label={copy.close}>
              <X size={17} aria-hidden="true" />
            </button>
          </header>
          <label className="glass-control-range">
            <span>{copy.blur}<output>{settings.blur}px</output></span>
            <input type="range" min="0" max="36" step="1" value={settings.blur} onChange={(event) => update({ ...settings, blur: Number(event.target.value) })} />
          </label>
          <label className="glass-control-range">
            <span>{copy.opacity}<output>{settings.opacity}%</output></span>
            <input type="range" min="10" max="92" step="1" value={settings.opacity} onChange={(event) => update({ ...settings, opacity: Number(event.target.value) })} />
          </label>
          <label className="glass-control-range">
            <span>{copy.saturation}<output>{settings.saturation}%</output></span>
            <input type="range" min="60" max="180" step="5" value={settings.saturation} onChange={(event) => update({ ...settings, saturation: Number(event.target.value) })} />
          </label>
          <label className="glass-control-color">
            <span>{copy.tint}</span>
            <input type="color" value={settings.tint} onChange={(event) => update({ ...settings, tint: event.target.value })} />
          </label>
          <div className="glass-control-wallpaper">
            <span>{copy.wallpaper}</span>
            <label className="glass-control-upload">
              <ImagePlus size={16} aria-hidden="true" />
              {copy.upload}
              <input type="file" accept="image/*" onChange={(event) => {
                void selectWallpaper(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }} />
            </label>
            {settings.wallpaper && <button type="button" className="glass-control-remove" onClick={() => update({ ...settings, wallpaper: "" })}>{copy.remove}</button>}
          </div>
          {error && <p className="glass-control-error" role="alert">{error}</p>}
          <button type="button" className="glass-control-reset" onClick={() => update(DEFAULTS)}>
            <RotateCcw size={15} aria-hidden="true" />{copy.reset}
          </button>
        </section>
      )}
    </div>
  );
}

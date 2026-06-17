"use client";

import { useEffect, useRef } from "react";

type Color = { red: number; green: number; blue: number; hex: string };

export function usePrimaryArtworkColor(artwork: string) {
  const lastArtworkRef = useRef("");
  useEffect(() => {
    if (typeof document === "undefined") return;
    const enabled = document.body.dataset.primaryColorFromArtwork === "true";
    if (!enabled || artwork === lastArtworkRef.current) return;
    lastArtworkRef.current = artwork;
    if (!artwork) return;
    let cancelled = false;
    getDominantColor(artwork).then((color) => {
      if (cancelled || !color || lastArtworkRef.current !== artwork) return;
      document.body.style.setProperty("--primary-color", color.hex);
      document.body.style.setProperty("--primary-color-rgb", `${color.red}, ${color.green}, ${color.blue}`);
    });
    return () => {
      cancelled = true;
    };
  }, [artwork]);
}

function getDominantColor(source: string): Promise<Color | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(extractDominantColor(image));
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

function extractDominantColor(image: HTMLImageElement): Color | null {
  const canvas = document.createElement("canvas");
  const size = 48;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  let pixels: Uint8ClampedArray;
  try {
    context.drawImage(image, 0, 0, size, size);
    pixels = context.getImageData(0, 0, size, size).data;
  } catch {
    return null;
  }
  const buckets = new Map<string, { red: number; green: number; blue: number; score: number; count: number }>();

  for (let index = 0; index < pixels.length; index += 16) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];
    if (alpha < 180) continue;

    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const lightness = (max + min) / 510;
    if (saturation < 0.18 || lightness < 0.16 || lightness > 0.88) continue;

    const key = `${Math.round(red / 24)},${Math.round(green / 24)},${Math.round(blue / 24)}`;
    const bucket = buckets.get(key) || { red: 0, green: 0, blue: 0, score: 0, count: 0 };
    const score = 1 + saturation * 2;
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    bucket.score += score;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const best = Array.from(buckets.values()).sort((left, right) => right.score - left.score)[0];
  if (!best) return null;
  const color = brightenForVisibility(
    Math.round(best.red / best.count),
    Math.round(best.green / best.count),
    Math.round(best.blue / best.count),
  );
  return { ...color, hex: rgbToHex(color.red, color.green, color.blue) };
}

function brightenForVisibility(red: number, green: number, blue: number) {
  let color = { red, green, blue };
  while (relativeLuminance(color.red, color.green, color.blue) < 0.42) {
    color = {
      red: mixChannel(color.red, 255, 0.22),
      green: mixChannel(color.green, 255, 0.22),
      blue: mixChannel(color.blue, 255, 0.22),
    };
  }
  return color;
}

function mixChannel(value: number, target: number, amount: number) {
  return Math.round(value + (target - value) * amount);
}

function relativeLuminance(red: number, green: number, blue: number) {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

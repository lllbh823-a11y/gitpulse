import Taro from '@tarojs/taro';
import { CATEGORIES, type CategoryId } from '@/types/gitpulse';

export function isH5Env(): boolean {
  return process.env.TARO_ENV === 'h5';
}

export function formatCount(num: number): string {
  if (!Number.isFinite(num) || num < 0) return '0';
  if (num >= 100000) {
    return `${(num / 1000).toFixed(0)}k`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(num);
}

export function formatExactNumber(num: number): string {
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('en-US');
}

export function formatDateShort(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[1]}.${parts[2]}`;
}

export function formatDateChinese(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日`;
}

export function getCategoryLabel(categoryId: CategoryId): string {
  const found = CATEGORIES.find((item) => item.id === categoryId);
  return found ? found.label : '其他精选';
}

export async function copyTextWithToast(text: string, label = 'GitHub 链接已复制'): Promise<boolean> {
  try {
    await Taro.setClipboardData({ data: text });
    Taro.showToast({
      title: label,
      icon: 'success',
      duration: 1800,
    });
    return true;
  } catch {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        Taro.showToast({
          title: label,
          icon: 'success',
          duration: 1800,
        });
        return true;
      } catch {
        // Fall through to toast
      }
    }
    Taro.showToast({
      title: '复制失败，请手动长按复制',
      icon: 'none',
      duration: 2000,
    });
    return false;
  }
}

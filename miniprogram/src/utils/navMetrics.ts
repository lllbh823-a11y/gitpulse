import Taro from '@tarojs/taro';
import { isH5Env } from './format';

export interface NavMetrics {
  statusBarHeight: number;
  navBarHeight: number;
  headerTotalHeight: number;
  capsuleSafeRight: number;
}

let cachedMetrics: NavMetrics | null = null;

export function getNavMetrics(): NavMetrics {
  if (cachedMetrics) {
    return cachedMetrics;
  }

  if (isH5Env()) {
    cachedMetrics = {
      statusBarHeight: 0,
      navBarHeight: 48,
      headerTotalHeight: 48,
      capsuleSafeRight: 16,
    };
    return cachedMetrics;
  }

  try {
    const windowInfo = typeof Taro.getWindowInfo === 'function'
      ? Taro.getWindowInfo()
      : Taro.getSystemInfoSync();
    const statusBarHeight = windowInfo.statusBarHeight || 20;
    const screenWidth = windowInfo.screenWidth || windowInfo.windowWidth || 375;

    let navBarHeight = 44;
    let capsuleSafeRight = 96;

    if (typeof Taro.getMenuButtonBoundingClientRect === 'function') {
      const menuButton = Taro.getMenuButtonBoundingClientRect();
      if (menuButton && menuButton.height > 0) {
        navBarHeight = Math.max(40, (menuButton.top - statusBarHeight) * 2 + menuButton.height);
        capsuleSafeRight = Math.max(92, screenWidth - menuButton.left + 12);
      }
    }

    cachedMetrics = {
      statusBarHeight,
      navBarHeight,
      headerTotalHeight: statusBarHeight + navBarHeight,
      capsuleSafeRight,
    };
    return cachedMetrics;
  } catch {
    cachedMetrics = {
      statusBarHeight: 20,
      navBarHeight: 44,
      headerTotalHeight: 64,
      capsuleSafeRight: 96,
    };
    return cachedMetrics;
  }
}

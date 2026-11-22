import path from 'node:path';
import { defineConfig, type UserConfigExport } from '@tarojs/cli';
import devConfig from './dev';
import prodConfig from './prod';

export default defineConfig<'vite'>(async (merge) => {
  const taroEnv = process.env.TARO_ENV || 'weapp';
  const baseConfig: UserConfigExport<'vite'> = {
    projectName: 'gitpulse-miniprogram',
    date: '2026-11-22',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2,
    },
    sourceRoot: 'src',
    outputRoot: `dist/${taroEnv}`,
    plugins: [],
    defineConstants: {
      __CLOUDBASE_ENV_ID__: JSON.stringify(process.env.TARO_APP_CLOUDBASE_ENV_ID || ''),
      __SUBSCRIBE_TEMPLATE_ID__: JSON.stringify(process.env.TARO_APP_SUBSCRIBE_TEMPLATE_ID || ''),
    },
    copy: {
      patterns: [
        { from: 'sitemap.json', to: `dist/${taroEnv}/sitemap.json` },
      ],
      options: {},
    },
    framework: 'react',
    compiler: {
      type: 'vite',
      prebundle: {
        enable: false,
      },
    },
    alias: {
      '@': path.resolve(__dirname, '..', 'src'),
    },
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
    },
    h5: {
      publicPath: process.env.TARO_APP_H5_PUBLIC_PATH || './',
      staticDirectory: 'static',
      devServer: {
        port: 10086,
        host: '127.0.0.1',
      },
      postcss: {
        autoprefixer: {
          enable: true,
          config: {},
        },
        pxtransform: {
          enable: true,
          config: {
            maxRootSize: 22.8,
            minRootSize: 18,
          },
        },
        cssModules: {
          enable: false,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
    },
  };

  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, devConfig);
  }
  return merge({}, baseConfig, prodConfig);
});

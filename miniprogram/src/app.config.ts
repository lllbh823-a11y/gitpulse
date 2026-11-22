export default defineAppConfig({
  pages: [
    'pages/today/index',
    'pages/discover/index',
    'pages/mine/index',
    'pages/detail/index',
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#F7F6F2',
    navigationBarTitleText: 'GitPulse',
    navigationBarTextStyle: 'black',
    navigationStyle: 'custom',
    backgroundColor: '#F7F6F2',
  },
  tabBar: {
    color: '#767F88',
    selectedColor: '#0F9D58',
    backgroundColor: '#FFFFFF',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/today/index',
        text: '今日',
        iconPath: 'assets/tab/today.png',
        selectedIconPath: 'assets/tab/today-active.png',
      },
      {
        pagePath: 'pages/discover/index',
        text: '发现',
        iconPath: 'assets/tab/discover.png',
        selectedIconPath: 'assets/tab/discover-active.png',
      },
      {
        pagePath: 'pages/mine/index',
        text: '我的',
        iconPath: 'assets/tab/mine.png',
        selectedIconPath: 'assets/tab/mine-active.png',
      },
    ],
  },
  style: 'v2',
  lazyCodeLoading: 'requiredComponents',
  sitemapLocation: 'sitemap.json',
});

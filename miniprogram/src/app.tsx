import { type PropsWithChildren } from 'react';
import { useLaunch } from '@tarojs/taro';
import { initCloudIfNeeded } from '@/services/api';
import './app.scss';

function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    initCloudIfNeeded();
  });

  return children;
}

export default App;

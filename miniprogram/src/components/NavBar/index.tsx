import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { getNavMetrics } from '@/utils/navMetrics';
import './index.scss';

interface NavBarProps {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  brandMode?: boolean;
  rightSlot?: React.ReactNode;
}

export default function NavBar({
  title = 'GitPulse',
  subtitle,
  showBack = false,
  brandMode = false,
  rightSlot,
}: NavBarProps) {
  const metrics = getNavMetrics();

  const handleBack = () => {
    const pages = Taro.getCurrentPages();
    if (pages.length > 1) {
      Taro.navigateBack();
    } else {
      Taro.switchTab({ url: '/pages/today/index' });
    }
  };

  return (
    <View className='gp-navbar-wrap'>
      <View
        className='gp-navbar'
        style={{
          paddingTop: `${metrics.statusBarHeight}px`,
          height: `${metrics.headerTotalHeight}px`,
        }}
      >
        <View
          className='gp-navbar__inner'
          style={{
            height: `${metrics.navBarHeight}px`,
            paddingRight: `${metrics.capsuleSafeRight}px`,
          }}
        >
          <View className='gp-navbar__left'>
            {showBack && (
              <View
                className='gp-navbar__back'
                hoverClass='gp-navbar__back--active'
                role='button'
                aria-label='返回上一页'
                onClick={handleBack}
              >
                <Text className='gp-navbar__back-arrow'>‹</Text>
              </View>
            )}

            {brandMode ? (
              <View className='gp-navbar__brand'>
                <View className='gp-navbar__dot' />
                <Text className='gp-navbar__wordmark'>GitPulse</Text>
                {subtitle && (
                  <Text className='gp-navbar__issue gp-tabular'>{subtitle}</Text>
                )}
              </View>
            ) : (
              <View className='gp-navbar__title-group'>
                <Text className='gp-navbar__title'>{title}</Text>
                {subtitle && (
                  <Text className='gp-navbar__subtitle gp-tabular'>{subtitle}</Text>
                )}
              </View>
            )}
          </View>

          {rightSlot && <View className='gp-navbar__right'>{rightSlot}</View>}
        </View>
      </View>

      <View
        className='gp-navbar__spacer'
        style={{ height: `${metrics.headerTotalHeight}px` }}
      />
    </View>
  );
}

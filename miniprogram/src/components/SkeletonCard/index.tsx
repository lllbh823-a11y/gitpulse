import { View } from '@tarojs/components';
import './index.scss';

interface SkeletonCardProps {
  count?: number;
}

export default function SkeletonCard({ count = 4 }: SkeletonCardProps) {
  return (
    <View className='gp-skeleton-list' aria-label='正在加载热门项目'>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} className='gp-skeleton-card'>
          <View className='gp-skeleton-card__top'>
            <View className='gp-skeleton-box gp-skeleton-box--rank' />
            <View className='gp-skeleton-card__title-col'>
              <View className='gp-skeleton-box gp-skeleton-box--owner' />
              <View className='gp-skeleton-box gp-skeleton-box--name' />
            </View>
            <View className='gp-skeleton-box gp-skeleton-box--pill' />
          </View>
          <View className='gp-skeleton-box gp-skeleton-box--line' />
          <View className='gp-skeleton-box gp-skeleton-box--line-short' />
          <View className='gp-skeleton-card__footer'>
            <View className='gp-skeleton-box gp-skeleton-box--meta' />
            <View className='gp-skeleton-box gp-skeleton-box--btn' />
          </View>
        </View>
      ))}
    </View>
  );
}

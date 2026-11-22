import { View, Text } from '@tarojs/components';
import './index.scss';

interface StateViewProps {
  variant: 'empty' | 'error';
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
}

export default function StateView({
  variant,
  title,
  description,
  actionText,
  onAction,
}: StateViewProps) {
  return (
    <View className='gp-state'>
      <View className={`gp-state__badge gp-state__badge--${variant}`}>
        <Text className='gp-state__symbol gp-tabular'>
          {variant === 'error' ? '!' : '◎'}
        </Text>
      </View>
      <Text className='gp-state__title'>{title}</Text>
      <Text className='gp-state__desc'>{description}</Text>
      {actionText && onAction && (
        <View
          className='gp-state__btn'
          hoverClass='gp-state__btn--active'
          role='button'
          onClick={onAction}
        >
          <Text className='gp-state__btn-text'>{actionText}</Text>
        </View>
      )}
    </View>
  );
}

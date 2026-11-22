import { View, Text } from '@tarojs/components';
import type { RepoItem } from '@/types/gitpulse';
import { formatCount, getCategoryLabel } from '@/utils/format';
import './index.scss';

interface RepoCardProps {
  repo: RepoItem;
  rank?: number;
  periodLabel?: string;
  bookmarked: boolean;
  onSelect: (repo: RepoItem) => void;
  onToggleBookmark: (repo: RepoItem) => void;
}

export default function RepoCard({
  repo,
  rank,
  periodLabel = '今日',
  bookmarked,
  onSelect,
  onToggleBookmark,
}: RepoCardProps) {
  const isTopThree = typeof rank === 'number' && rank >= 1 && rank <= 3;

  return (
    <View
      className={`gp-card ${isTopThree ? 'gp-card--featured' : ''}`}
      hoverClass='gp-card--pressed'
      onClick={() => onSelect(repo)}
    >
      <View className='gp-card__top'>
        <View className='gp-card__identity'>
          {typeof rank === 'number' && (
            <View className={`gp-card__rank gp-tabular ${isTopThree ? 'gp-card__rank--top' : ''}`}>
              <Text>{String(rank).padStart(2, '0')}</Text>
            </View>
          )}
          <View className='gp-card__name-wrap'>
            <Text className='gp-card__owner'>{repo.owner} /</Text>
            <Text className='gp-card__name'>{repo.name}</Text>
          </View>
        </View>

        <View className='gp-card__delta gp-tabular'>
          <Text className='gp-card__delta-value'>+{formatCount(repo.starsToday)}</Text>
          <Text className='gp-card__delta-unit'>★ {periodLabel}</Text>
        </View>
      </View>

      <View className='gp-card__summary-row'>
        <Text className='gp-card__tagline'>{repo.ai.tagline}</Text>
      </View>

      <View className='gp-card__tags'>
        <View className='gp-card__cat-tag'>
          <Text>{getCategoryLabel(repo.category)}</Text>
        </View>
        {repo.tags.slice(0, 3).map((tag) => (
          <View key={tag} className='gp-card__tag'>
            <Text>{tag}</Text>
          </View>
        ))}
        {repo.ai.aiStatus === 'fallback' ? (
          <View className='gp-card__fallback-tag'>
            <Text>基础速览</Text>
          </View>
        ) : (
          <View className='gp-card__ai-tag'>
            <Text>AI 辅助生成</Text>
          </View>
        )}
      </View>

      <View className='gp-card__footer'>
        <View className='gp-card__meta'>
          <View className='gp-card__meta-item'>
            <View
              className='gp-card__lang-dot'
              style={{ backgroundColor: repo.languageColor || '#767F88' }}
            />
            <Text className='gp-card__meta-text'>{repo.language || 'Unknown'}</Text>
          </View>
          <Text className='gp-card__meta-sep'>·</Text>
          <Text className='gp-card__meta-text gp-tabular'>★ {formatCount(repo.stars)}</Text>
          <Text className='gp-card__meta-sep'>·</Text>
          <Text className='gp-card__meta-text gp-tabular'>⑂ {formatCount(repo.forks)}</Text>
        </View>

        <View
          className={`gp-card__bookmark ${bookmarked ? 'gp-card__bookmark--saved' : ''}`}
          hoverClass='gp-card__bookmark--active'
          role='button'
          aria-label={bookmarked ? `取消收藏 ${repo.fullName}` : `收藏 ${repo.fullName}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleBookmark(repo);
          }}
        >
          <Text className='gp-card__bookmark-icon'>{bookmarked ? '★' : '☆'}</Text>
          <Text className='gp-card__bookmark-text'>{bookmarked ? '已藏' : '收藏'}</Text>
        </View>
      </View>
    </View>
  );
}

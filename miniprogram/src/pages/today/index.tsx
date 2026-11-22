import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from '@tarojs/components';
import Taro, {
  useDidShow,
  usePullDownRefresh,
  useRouter,
  useShareAppMessage,
} from '@tarojs/taro';
import NavBar from '@/components/NavBar';
import RepoCard from '@/components/RepoCard';
import SkeletonCard from '@/components/SkeletonCard';
import StateView from '@/components/StateView';
import {
  fetchDailyIssue,
  getRuntimeMode,
  requestDailyPushReservation,
  toggleBookmark,
} from '@/services/api';
import {
  CATEGORIES,
  type CategoryId,
  type DailyIssue,
  type PushSubscriptionState,
  type RepoItem,
  type TrendingPeriod,
} from '@/types/gitpulse';
import { formatDateChinese, formatDateShort, getCategoryLabel } from '@/utils/format';
import './index.scss';

export default function TodayPage() {
  const router = useRouter();
  const initialDate = router.params?.date || '';

  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [period, setPeriod] = useState<TrendingPeriod>('daily');
  const [category, setCategory] = useState<CategoryId>('all');

  const [issue, setIssue] = useState<DailyIssue | null>(null);
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [bookmarkedSet, setBookmarkedSet] = useState<Set<string>>(new Set());
  const [subscription, setSubscription] = useState<PushSubscriptionState>({
    remainingCount: 0,
    preferredCategory: 'all',
    lastPushedDate: null,
    templateId: '',
  });

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [subscribing, setSubscribing] = useState<boolean>(false);
  const [showPreviewNotice, setShowPreviewNotice] = useState<boolean>(
    getRuntimeMode() === 'snapshot',
  );

  const loadIssue = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) {
        setLoading(true);
      }
      setErrorMsg('');
      try {
        const res = await fetchDailyIssue({
          date: selectedDate || undefined,
          period,
          category,
        });
        setIssue(res.issue);
        setRepos(res.repos);
        setAvailableDates(res.availableDates);
        if (!selectedDate && res.issue?.date) {
          setSelectedDate(res.issue.date);
        }
        setBookmarkedSet(new Set(res.bookmarkedIds));
        setSubscription(res.subscription);
      } catch (err) {
        const message = err instanceof Error ? err.message : '加载热榜失败，请稍后重试';
        setErrorMsg(message);
      } finally {
        setLoading(false);
        try {
          Promise.resolve(Taro.stopPullDownRefresh()).catch(() => {});
        } catch {
          // Ignore on platforms where stopPullDownRefresh is unsupported
        }
      }
    },
    [selectedDate, period, category],
  );

  useEffect(() => {
    loadIssue();
  }, [loadIssue]);

  useDidShow(() => {
    if (!loading) {
      loadIssue({ silent: true });
    }
  });

  usePullDownRefresh(() => {
    loadIssue({ silent: true });
  });

  useShareAppMessage(() => ({
    title: issue
      ? `GitPulse 第${issue.issueNo}期 · ${issue.summary}`
      : 'GitPulse 开源每日脉搏 · 每日 3 分钟看懂 GitHub 热门项目',
    path: `/pages/today/index${issue?.date ? `?date=${issue.date}` : ''}`,
  }));

  const handleOpenDetail = (repo: RepoItem) => {
    Taro.navigateTo({
      url: `/pages/detail/index?id=${encodeURIComponent(repo._id)}`,
    });
  };

  const handleToggleBookmark = async (repo: RepoItem) => {
    const prevSaved = bookmarkedSet.has(repo._id);
    const optimistic = new Set(bookmarkedSet);
    if (prevSaved) {
      optimistic.delete(repo._id);
    } else {
      optimistic.add(repo._id);
    }
    setBookmarkedSet(optimistic);

    try {
      const result = await toggleBookmark(repo._id);
      Taro.showToast({
        title: result.bookmarked ? '已加入收藏夹' : '已取消收藏',
        icon: 'none',
        duration: 1400,
      });
    } catch {
      setBookmarkedSet(bookmarkedSet);
      Taro.showToast({
        title: '操作失败，请重试',
        icon: 'none',
      });
    }
  };

  const handleSubscribe = async () => {
    if (subscribing) return;
    setSubscribing(true);
    try {
      const result = await requestDailyPushReservation(subscription.templateId);
      setSubscription(result.state);
      if (result.accepted) {
        Taro.showToast({
          title:
            result.mode === 'preview'
              ? `预览模式：已预约（剩余 ${result.state.remainingCount} 次）`
              : `预约成功，剩余 ${result.state.remainingCount} 次推送`,
          icon: 'none',
          duration: 2000,
        });
      } else {
        Taro.showToast({
          title: '未开启推送提醒，可随时再次预约',
          icon: 'none',
          duration: 1800,
        });
      }
    } catch {
      Taro.showToast({
        title: '订阅请求失败，请稍后再试',
        icon: 'none',
      });
    } finally {
      setSubscribing(false);
    }
  };

  const issueBadge = issue
    ? `ISSUE #${String(issue.issueNo).padStart(3, '0')}`
    : 'DAILY DIGEST';

  return (
    <View className='gp-today'>
      <NavBar brandMode subtitle={issueBadge} />

      <View className='gp-today__body'>
        {showPreviewNotice && (
          <View className='gp-preview-bar'>
            <Text className='gp-preview-bar__text'>
              快照预览模式 · 接入云开发环境 ID 后自动切换线上实时数据
            </Text>
            <View
              className='gp-preview-bar__close'
              role='button'
              aria-label='关闭提示'
              onClick={() => setShowPreviewNotice(false)}
            >
              <Text>×</Text>
            </View>
          </View>
        )}

        {/* Editorial Digest Header Card */}
        <View className='gp-digest-hero'>
          <View className='gp-digest-hero__meta'>
            <View className='gp-digest-hero__date-col'>
              <Text className='gp-digest-hero__kicker'>开源每日脉搏</Text>
              <Text className='gp-digest-hero__date'>
                {issue ? formatDateChinese(issue.date) : '每日 07:30 更新'}
              </Text>
            </View>

            <View className='gp-period-switch' role='tablist' aria-label='榜单周期切换'>
              <View
                className={`gp-period-switch__item ${period === 'daily' ? 'gp-period-switch__item--active' : ''}`}
                role='tab'
                onClick={() => setPeriod('daily')}
              >
                <Text>日榜</Text>
              </View>
              <View
                className={`gp-period-switch__item ${period === 'weekly' ? 'gp-period-switch__item--active' : ''}`}
                role='tab'
                onClick={() => setPeriod('weekly')}
              >
                <Text>周榜</Text>
              </View>
            </View>
          </View>

          {availableDates.length > 1 && (
            <ScrollView
              scrollX
              enableFlex
              showScrollbar={false}
              className='gp-date-strip'
            >
              <View className='gp-date-strip__inner'>
                {availableDates.map((d, idx) => {
                  const active = (selectedDate || availableDates[0]) === d;
                  return (
                    <View
                      key={d}
                      className={`gp-date-chip gp-tabular ${active ? 'gp-date-chip--active' : ''}`}
                      role='button'
                      onClick={() => setSelectedDate(d)}
                    >
                      <Text>{idx === 0 ? `最新 · ${formatDateShort(d)}` : formatDateShort(d)}</Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          )}

          <View className='gp-digest-hero__brief'>
            <View className='gp-digest-hero__brief-head'>
              <Text className='gp-digest-hero__brief-label'>今日风向</Text>
              <View className='gp-digest-hero__ai-pill'>
                <Text>AI 辅助生成</Text>
              </View>
            </View>
            <Text className='gp-digest-hero__summary'>
              {issue?.summary || '正在为你整理 GitHub 今日最值得关注的开源突破与 AI 中文速览…'}
            </Text>
          </View>

          <View className='gp-subscribe-strip'>
            <View className='gp-subscribe-strip__info'>
              <View className='gp-subscribe-strip__status'>
                <View
                  className={`gp-subscribe-strip__indicator ${
                    subscription.remainingCount > 0 ? 'gp-subscribe-strip__indicator--on' : ''
                  }`}
                />
                <Text className='gp-subscribe-strip__title'>
                  {subscription.remainingCount > 0
                    ? `已预约 ${subscription.remainingCount} 次晨报推送`
                    : '每日 08:30 微信晨报提醒'}
                </Text>
              </View>
              <Text className='gp-subscribe-strip__sub'>
                {subscription.remainingCount > 0
                  ? `关注领域：${getCategoryLabel(subscription.preferredCategory)} · 可累加预约`
                  : '一次性订阅，点一次推一次，绝不打扰'}
              </Text>
            </View>

            <View
              className={`gp-subscribe-strip__cta ${subscribing ? 'gp-subscribe-strip__cta--busy' : ''}`}
              hoverClass='gp-subscribe-strip__cta--active'
              role='button'
              aria-label='预约明日热榜推送'
              onClick={handleSubscribe}
            >
              <Text className='gp-subscribe-strip__cta-text'>
                {subscription.remainingCount > 0 ? '+1 续订' : '预约推送'}
              </Text>
            </View>
          </View>
        </View>

        {/* Horizontal Category Chips */}
        <ScrollView
          scrollX
          enableFlex
          showScrollbar={false}
          className='gp-cat-bar'
        >
          <View className='gp-cat-bar__inner'>
            {CATEGORIES.map((item) => {
              const active = category === item.id;
              return (
                <View
                  key={item.id}
                  className={`gp-cat-chip ${active ? 'gp-cat-chip--active' : ''}`}
                  role='button'
                  onClick={() => setCategory(item.id)}
                >
                  <Text>{item.label}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>

        {/* Section Heading */}
        {!loading && !errorMsg && repos.length > 0 && (
          <View className='gp-section-head'>
            <Text className='gp-section-head__title'>
              {period === 'daily' ? '今日精选热榜' : '本周高增长精选'}
            </Text>
            <Text className='gp-section-head__count gp-tabular'>
              共 {repos.length} 项
            </Text>
          </View>
        )}

        {/* Content Area */}
        {loading ? (
          <SkeletonCard count={4} />
        ) : errorMsg ? (
          <StateView
            variant='error'
            title='热榜加载遇到点问题'
            description={errorMsg}
            actionText='重新加载'
            onAction={() => loadIssue()}
          />
        ) : repos.length === 0 ? (
          <StateView
            variant='empty'
            title='该赛道本期暂无上榜项目'
            description='可以切换回「全部」赛道，或切到周榜 / 往期看看其他开源突破。'
            actionText={category !== 'all' ? '查看全部领域' : '刷新榜单'}
            onAction={() => {
              if (category !== 'all') {
                setCategory('all');
              } else {
                loadIssue();
              }
            }}
          />
        ) : (
          <View className='gp-repo-list'>
            {repos.map((repo, index) => (
              <RepoCard
                key={repo._id}
                repo={repo}
                rank={index + 1}
                periodLabel={period === 'daily' ? '今日' : '本周'}
                bookmarked={bookmarkedSet.has(repo._id)}
                onSelect={handleOpenDetail}
                onToggleBookmark={handleToggleBookmark}
              />
            ))}
            <View className='gp-list-end'>
              <Text className='gp-list-end__text'>— 已展示本期全部精选项目 —</Text>
              <Text className='gp-list-end__note'>
                中文速览由 AI 辅助生成，仅供参考 · 开源项目归原作者及对应协议所有
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

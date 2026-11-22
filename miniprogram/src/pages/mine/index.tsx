import { useCallback, useEffect, useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import NavBar from '@/components/NavBar';
import RepoCard from '@/components/RepoCard';
import SkeletonCard from '@/components/SkeletonCard';
import StateView from '@/components/StateView';
import {
  fetchBookmarks,
  fetchSubscriptionState,
  getRuntimeMode,
  requestDailyPushReservation,
  toggleBookmark,
  updateSubscriptionPreference,
} from '@/services/api';
import {
  CATEGORIES,
  type CategoryId,
  type PushSubscriptionState,
  type RepoItem,
} from '@/types/gitpulse';
import { copyTextWithToast, getCategoryLabel, isH5Env } from '@/utils/format';
import './index.scss';

export default function MinePage() {
  const [bookmarks, setBookmarks] = useState<RepoItem[]>([]);
  const [subscription, setSubscription] = useState<PushSubscriptionState>({
    remainingCount: 0,
    preferredCategory: 'all',
    lastPushedDate: null,
    templateId: '',
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [subscribing, setSubscribing] = useState<boolean>(false);
  const [showPrivacy, setShowPrivacy] = useState<boolean>(false);

  const loadMineData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
    }
    setErrorMsg('');
    try {
      const [bmRes, subRes] = await Promise.all([
        fetchBookmarks(1, 50),
        fetchSubscriptionState(),
      ]);
      setBookmarks(bmRes.items);
      setSubscription(subRes);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载个人中心失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMineData();
  }, [loadMineData]);

  useDidShow(() => {
    if (!loading) {
      loadMineData({ silent: true });
    }
  });

  const handleSubscribe = async () => {
    if (subscribing) return;
    setSubscribing(true);
    try {
      const result = await requestDailyPushReservation(subscription.templateId);
      setSubscription(result.state);
      if (result.accepted) {
        Taro.showToast({
          title: `预约成功，当前剩余 ${result.state.remainingCount} 次`,
          icon: 'none',
          duration: 1800,
        });
      }
    } catch {
      Taro.showToast({
        title: '预约失败，请稍后重试',
        icon: 'none',
      });
    } finally {
      setSubscribing(false);
    }
  };

  const handleSelectPreference = async (categoryId: CategoryId) => {
    const prev = subscription.preferredCategory;
    setSubscription((s) => ({ ...s, preferredCategory: categoryId }));
    try {
      const next = await updateSubscriptionPreference(categoryId);
      setSubscription(next);
      Taro.showToast({
        title: `推送偏好已设为：${getCategoryLabel(categoryId)}`,
        icon: 'none',
        duration: 1500,
      });
    } catch {
      setSubscription((s) => ({ ...s, preferredCategory: prev }));
      Taro.showToast({ title: '保存偏好失败', icon: 'none' });
    }
  };

  const handleRemoveBookmark = async (repo: RepoItem) => {
    const prev = bookmarks;
    setBookmarks((list) => list.filter((item) => item._id !== repo._id));
    try {
      await toggleBookmark(repo._id);
      Taro.showToast({
        title: '已移出收藏夹',
        icon: 'none',
        duration: 1400,
      });
    } catch {
      setBookmarks(prev);
      Taro.showToast({ title: '移除失败，请重试', icon: 'none' });
    }
  };

  const handleCopyAllBookmarks = () => {
    if (bookmarks.length === 0) return;
    const text = bookmarks
      .map((item, idx) => `${idx + 1}. ${item.fullName} — ${item.ai.tagline}\n${item.url}`)
      .join('\n\n');
    copyTextWithToast(text, `已复制 ${bookmarks.length} 个收藏链接`);
  };

  const handleOpenDetail = (repo: RepoItem) => {
    Taro.navigateTo({
      url: `/pages/detail/index?id=${encodeURIComponent(repo._id)}`,
    });
  };

  const handleH5Feedback = () => {
    if (isH5Env()) {
      Taro.showToast({
        title: '微信小程序端将直接拉起官方意见反馈面板',
        icon: 'none',
        duration: 2000,
      });
    }
  };

  const handleCopyFeedUrl = (fileName: 'rss.xml' | 'feed.json') => {
    const base =
      typeof window !== 'undefined' && window.location
        ? `${window.location.origin}${window.location.pathname.replace(/index\.html$/, '').replace(/\/+$/, '')}`
        : '';
    const feedUrl = base ? `${base}/${fileName}` : fileName;
    copyTextWithToast(
      feedUrl,
      fileName === 'rss.xml' ? 'RSS 订阅地址已复制' : 'JSON Feed 地址已复制',
    );
  };

  return (
    <View className='gp-mine'>
      <NavBar
        title='我的'
        subtitle={getRuntimeMode() === 'cloudbase' ? '云端已同步' : '本地快照模式'}
      />

      <View className='gp-mine__body'>
        {/* Push Subscription Center Card */}
        <View className='gp-push-card'>
          <View className='gp-push-card__header'>
            <View className='gp-push-card__title-col'>
              <Text className='gp-push-card__kicker'>每日 08:30 晨报订阅</Text>
              <Text className='gp-push-card__title'>微信一次性订阅推送</Text>
            </View>
            <View className='gp-push-card__quota'>
              <Text className='gp-push-card__quota-num gp-tabular'>
                {subscription.remainingCount}
              </Text>
              <Text className='gp-push-card__quota-label'>剩余次数</Text>
            </View>
          </View>

          <Text className='gp-push-card__desc'>
            遵循微信小程序规范，每次点击授权增加 1 次次日晨报推送额度，可多次点击累加，绝不静默骚扰。
          </Text>

          <View className='gp-push-card__pref'>
            <Text className='gp-push-card__pref-title'>推送首选领域（优先推送该赛道 Top 1）</Text>
            <View className='gp-push-card__pref-chips'>
              {CATEGORIES.map((cat) => {
                const active = subscription.preferredCategory === cat.id;
                return (
                  <View
                    key={cat.id}
                    className={`gp-pref-chip ${active ? 'gp-pref-chip--active' : ''}`}
                    role='button'
                    onClick={() => handleSelectPreference(cat.id)}
                  >
                    <Text>{cat.label}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View className='gp-push-card__actions'>
            <View
              className='gp-push-card__cta'
              hoverClass='gp-push-card__cta--active'
              role='button'
              onClick={handleSubscribe}
            >
              <Text className='gp-push-card__cta-text'>
                {subscription.remainingCount > 0
                  ? `+1 补充预约推送（当前 ${subscription.remainingCount} 次）`
                  : '立即预约明日 08:30 晨报推送'}
              </Text>
            </View>
          </View>
        </View>

        {/* Bookmarks Section */}
        <View className='gp-bm-section'>
          <View className='gp-bm-section__head'>
            <View className='gp-bm-section__title-row'>
              <Text className='gp-bm-section__title'>我的收藏夹</Text>
              <View className='gp-bm-section__count gp-tabular'>
                <Text>{bookmarks.length}</Text>
              </View>
            </View>

            {bookmarks.length > 0 && (
              <View
                className='gp-bm-section__export'
                hoverClass='gp-bm-section__export--active'
                role='button'
                onClick={handleCopyAllBookmarks}
              >
                <Text>批量复制链接</Text>
              </View>
            )}
          </View>

          {loading ? (
            <SkeletonCard count={2} />
          ) : errorMsg ? (
            <StateView
              variant='error'
              title='收藏夹读取失败'
              description={errorMsg}
              actionText='重新加载'
              onAction={() => loadMineData()}
            />
          ) : bookmarks.length === 0 ? (
            <StateView
              variant='empty'
              title='还没有收藏任何开源项目'
              description='在「今日」或「发现」页点击卡片右下角的收藏按钮，即可将感兴趣的仓库收入囊中。'
              actionText='去今日热榜逛逛'
              onAction={() => Taro.switchTab({ url: '/pages/today/index' })}
            />
          ) : (
            <View className='gp-bm-list'>
              {bookmarks.map((repo) => (
                <RepoCard
                  key={repo._id}
                  repo={repo}
                  periodLabel='热榜'
                  bookmarked
                  onSelect={handleOpenDetail}
                  onToggleBookmark={handleRemoveBookmark}
                />
              ))}
            </View>
          )}
        </View>

        {/* Web-only RSS Syndication Card */}
        {isH5Env() && (
          <View className='gp-rss-card'>
            <View className='gp-rss-card__head'>
              <Text className='gp-rss-card__kicker'>OPEN WEB & SYNDICATION</Text>
              <Text className='gp-rss-card__title'>RSS / JSON Feed 订阅</Text>
            </View>
            <Text className='gp-rss-card__desc'>
              支持 Folo、Feedly、Inoreader、Readwise Reader 等任意阅读器订阅每日 GitHub 精选与 AI 中文速览。
            </Text>
            <View className='gp-rss-card__actions'>
              <View
                className='gp-rss-btn gp-rss-btn--primary'
                hoverClass='gp-rss-btn--active'
                role='button'
                onClick={() => handleCopyFeedUrl('rss.xml')}
              >
                <Text>复制 RSS 地址 (rss.xml)</Text>
              </View>
              <View
                className='gp-rss-btn'
                hoverClass='gp-rss-btn--active'
                role='button'
                onClick={() => handleCopyFeedUrl('feed.json')}
              >
                <Text>复制 JSON Feed</Text>
              </View>
            </View>
          </View>
        )}

        {/* Compliance & About Card */}
        <View className='gp-compliance-card'>
          <Text className='gp-compliance-card__title'>数据来源与合规说明</Text>
          <View className='gp-compliance-card__list'>
            <Text className='gp-compliance-card__item'>
              • 每日 07:30 采集开源仓库公开元数据并由 AI 辅助生成中文技术速览，内容仅供参考，原项目归原作者及对应开源协议所有。
            </Text>
            <Text className='gp-compliance-card__item'>
              • 内置多重内容安全过滤与微信安全检测机制，自动拦截不适宜公开发布的仓库内容。
            </Text>
            <Text className='gp-compliance-card__item'>
              • 遵循微信小程序外链规范，小程序内不直接内嵌第三方网页，支持一键复制仓库链接到浏览器访问。
            </Text>
          </View>

          <View className='gp-compliance-card__footer'>
            <View
              className='gp-compliance-btn'
              role='button'
              onClick={() => setShowPrivacy((v) => !v)}
            >
              <Text>{showPrivacy ? '收起隐私保护指引' : '隐私保护指引'}</Text>
            </View>

            <Button
              className='gp-feedback-btn'
              openType='feedback'
              onClick={handleH5Feedback}
            >
              意见反馈
            </Button>
          </View>

          {showPrivacy && (
            <View className='gp-privacy-panel'>
              <Text className='gp-privacy-panel__text'>
                1. 账号识别：仅在云开发环境下使用微信云原生 OPENID 关联你的收藏夹与推送预约额度，不收集手机号、头像或位置信息。
              </Text>
              <Text className='gp-privacy-panel__text'>
                2. 剪贴板权限：仅在你主动点击「复制 GitHub 链接」或「批量复制链接」按钮时写入剪贴板，绝不读取剪贴板内容。
              </Text>
              <Text className='gp-privacy-panel__text'>
                3. 订阅消息：仅在你主动点击预约按钮并授权后发送对应次数的每日精选提醒，可随时停止续订。
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

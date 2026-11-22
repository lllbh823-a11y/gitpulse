import { useCallback, useEffect, useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro';
import NavBar from '@/components/NavBar';
import SkeletonCard from '@/components/SkeletonCard';
import StateView from '@/components/StateView';
import { getRepoById, toggleBookmark } from '@/services/api';
import type { RepoItem } from '@/types/gitpulse';
import {
  copyTextWithToast,
  formatCount,
  formatDateChinese,
  formatExactNumber,
  getCategoryLabel,
  isH5Env,
} from '@/utils/format';
import './index.scss';

export default function DetailPage() {
  const router = useRouter();
  const repoId = decodeURIComponent(router.params?.id || '');

  const [repo, setRepo] = useState<RepoItem | null>(null);
  const [bookmarked, setBookmarked] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await getRepoById(repoId);
      setRepo(res.repo);
      setBookmarked(res.bookmarked);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载项目详情失败');
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useShareAppMessage(() => ({
    title: repo
      ? `${repo.fullName} · ${repo.ai.tagline}`
      : 'GitPulse 开源每日脉搏',
    path: `/pages/detail/index?id=${encodeURIComponent(repoId)}`,
  }));

  const handleToggleBookmark = async () => {
    if (!repo) return;
    const prev = bookmarked;
    setBookmarked(!prev);
    try {
      const res = await toggleBookmark(repo._id);
      setBookmarked(res.bookmarked);
      Taro.showToast({
        title: res.bookmarked ? '已加入收藏夹' : '已取消收藏',
        icon: 'none',
        duration: 1400,
      });
    } catch {
      setBookmarked(prev);
      Taro.showToast({ title: '收藏操作失败', icon: 'none' });
    }
  };

  const handleCopyUrl = () => {
    if (!repo) return;
    copyTextWithToast(repo.url, '仓库链接已复制，可在浏览器打开');
  };

  const handleH5Share = () => {
    if (!repo || !isH5Env()) return;
    copyTextWithToast(
      `【GitPulse 开源精选】${repo.fullName}：${repo.ai.tagline}\n${repo.url}`,
      '分享文案已复制到剪贴板',
    );
  };

  return (
    <View className='gp-detail'>
      <NavBar
        showBack
        title='项目深度速览'
        subtitle={repo ? repo.owner : undefined}
      />

      <View className='gp-detail__body'>
        {loading ? (
          <SkeletonCard count={2} />
        ) : errorMsg ? (
          <StateView
            variant='error'
            title='项目详情读取失败'
            description={errorMsg}
            actionText='重新加载'
            onAction={loadDetail}
          />
        ) : !repo ? (
          <StateView
            variant='empty'
            title='未找到该开源项目'
            description='该项目可能尚未收录或链接参数不完整，可以返回今日热榜浏览最新项目。'
            actionText='返回今日热榜'
            onAction={() => Taro.switchTab({ url: '/pages/today/index' })}
          />
        ) : (
          <View className='gp-detail__content'>
            {/* Hero Masthead Card */}
            <View className='gp-detail-hero'>
              <View className='gp-detail-hero__badges'>
                <View className='gp-detail-hero__cat'>
                  <Text>{getCategoryLabel(repo.category)}</Text>
                </View>
                <View className='gp-detail-hero__lang'>
                  <View
                    className='gp-detail-hero__lang-dot'
                    style={{ backgroundColor: repo.languageColor || '#767F88' }}
                  />
                  <Text>{repo.language}</Text>
                </View>
                <View className='gp-detail-hero__license gp-tabular'>
                  <Text>{repo.license || 'MIT'}</Text>
                </View>
              </View>

              <Text className='gp-detail-hero__fullname'>{repo.fullName}</Text>
              <Text className='gp-detail-hero__tagline'>{repo.ai.tagline}</Text>

              <View className='gp-detail-hero__tags'>
                {repo.tags.map((tag) => (
                  <View key={tag} className='gp-detail-hero__tag'>
                    <Text>#{tag}</Text>
                  </View>
                ))}
              </View>

              <View className='gp-metrics-grid'>
                <View className='gp-metrics-grid__cell'>
                  <Text className='gp-metrics-grid__val gp-tabular'>
                    {formatExactNumber(repo.stars)}
                  </Text>
                  <Text className='gp-metrics-grid__label'>总 Star 数</Text>
                </View>
                <View className='gp-metrics-grid__cell gp-metrics-grid__cell--accent'>
                  <Text className='gp-metrics-grid__val gp-metrics-grid__val--accent gp-tabular'>
                    +{formatCount(repo.starsToday)}
                  </Text>
                  <Text className='gp-metrics-grid__label'>本期新增 ★</Text>
                </View>
                <View className='gp-metrics-grid__cell'>
                  <Text className='gp-metrics-grid__val gp-tabular'>
                    {formatExactNumber(repo.forks)}
                  </Text>
                  <Text className='gp-metrics-grid__label'>Forks</Text>
                </View>
              </View>
            </View>

            {/* AI Generated Content Disclosure */}
            <View className='gp-ai-disclosure'>
              <Text className='gp-ai-disclosure__badge'>
                {repo.ai.aiStatus === 'ok' ? 'AI 辅助生成' : '自动整理'}
              </Text>
              <Text className='gp-ai-disclosure__text'>
                {repo.ai.aiStatus === 'ok'
                  ? '以下中文速览与技术亮点由 AI 辅助生成，仅供参考，请以原仓库文档与开源协议为准。'
                  : '以下基础速览基于仓库公开元数据自动整理，仅供参考，请以原仓库文档为准。'}
              </Text>
            </View>

            {/* Section 01: Why Hot */}
            <View className='gp-editorial-card'>
              <View className='gp-editorial-card__head'>
                <Text className='gp-editorial-card__num gp-tabular'>01</Text>
                <Text className='gp-editorial-card__title'>为什么近期爆火</Text>
              </View>
              <Text className='gp-editorial-card__body'>{repo.ai.whyHot}</Text>
            </View>

            {/* Section 02: 3 Key Highlights */}
            <View className='gp-editorial-card'>
              <View className='gp-editorial-card__head'>
                <Text className='gp-editorial-card__num gp-tabular'>02</Text>
                <Text className='gp-editorial-card__title'>三大核心亮点</Text>
              </View>
              <View className='gp-highlights-list'>
                {repo.ai.highlights.map((item, idx) => (
                  <View key={idx} className='gp-highlight-item'>
                    <View className='gp-highlight-item__bullet gp-tabular'>
                      <Text>{idx + 1}</Text>
                    </View>
                    <Text className='gp-highlight-item__text'>{item}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Section 03: Target Audience */}
            <View className='gp-editorial-card'>
              <View className='gp-editorial-card__head'>
                <Text className='gp-editorial-card__num gp-tabular'>03</Text>
                <Text className='gp-editorial-card__title'>最适合谁用</Text>
              </View>
              <Text className='gp-editorial-card__body'>{repo.ai.targetAudience}</Text>
            </View>

            {/* Section 04: Original Description & Link Card */}
            <View className='gp-source-card'>
              <Text className='gp-source-card__label'>GitHub 原始英文简介</Text>
              <Text className='gp-source-card__desc'>{repo.description}</Text>

              <View className='gp-source-card__url-box' onClick={handleCopyUrl}>
                <View className='gp-source-card__url-col'>
                  <Text className='gp-source-card__url-title'>仓库地址（点击直接复制）</Text>
                  <Text className='gp-source-card__url gp-tabular'>{repo.url}</Text>
                </View>
                <Text className='gp-source-card__copy-tag'>复制</Text>
              </View>

              <Text className='gp-source-card__updated'>
                最近上榜收录日期：{formatDateChinese(repo.latestDate)}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Fixed Safe-Area Bottom Bar */}
      {repo && (
        <View className='gp-detail-bar'>
          <View
            className={`gp-detail-bar__icon-btn ${bookmarked ? 'gp-detail-bar__icon-btn--saved' : ''}`}
            hoverClass='gp-detail-bar__icon-btn--active'
            role='button'
            aria-label={bookmarked ? '取消收藏' : '加入收藏'}
            onClick={handleToggleBookmark}
          >
            <Text className='gp-detail-bar__icon'>{bookmarked ? '★' : '☆'}</Text>
            <Text className='gp-detail-bar__btn-label'>{bookmarked ? '已收藏' : '收藏'}</Text>
          </View>

          <Button
            className='gp-detail-bar__share-btn'
            openType='share'
            onClick={handleH5Share}
          >
            分享好友
          </Button>

          <View
            className='gp-detail-bar__primary'
            hoverClass='gp-detail-bar__primary--active'
            role='button'
            onClick={handleCopyUrl}
          >
            <Text className='gp-detail-bar__primary-text'>一键复制 GitHub 链接</Text>
          </View>
        </View>
      )}
    </View>
  );
}

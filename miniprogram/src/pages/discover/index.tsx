import { useCallback, useEffect, useState } from 'react';
import { Input, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import NavBar from '@/components/NavBar';
import RepoCard from '@/components/RepoCard';
import SkeletonCard from '@/components/SkeletonCard';
import StateView from '@/components/StateView';
import {
  getAvailableLanguages,
  searchRepos,
  toggleBookmark,
} from '@/services/api';
import {
  CATEGORIES,
  type CategoryId,
  type RepoItem,
} from '@/types/gitpulse';
import './index.scss';

const HOT_KEYWORDS = ['Agent', 'Rust', '推理', '浏览器', 'CSS', 'SQL'];
const PAGE_SIZE = 10;

export default function DiscoverPage() {
  const [keyword, setKeyword] = useState<string>('');
  const [submittedKeyword, setSubmittedKeyword] = useState<string>('');
  const [category, setCategory] = useState<CategoryId>('all');
  const [language, setLanguage] = useState<string>('');

  const [items, setItems] = useState<RepoItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [bookmarkedSet, setBookmarkedSet] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const languages = getAvailableLanguages();

  const runSearch = useCallback(
    async (targetPage: number, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setErrorMsg('');

      try {
        const res = await searchRepos({
          keyword: submittedKeyword,
          category,
          language,
          page: targetPage,
          pageSize: PAGE_SIZE,
        });
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setTotal(res.total);
        setPage(targetPage);
        setHasMore(res.hasMore);
        setBookmarkedSet(new Set(res.bookmarkedIds));
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : '检索失败，请稍后重试');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [submittedKeyword, category, language],
  );

  useEffect(() => {
    runSearch(1, false);
  }, [runSearch]);

  useDidShow(() => {
    if (!loading) {
      runSearch(1, false);
    }
  });

  const handleApplyKeyword = (nextKw: string) => {
    setKeyword(nextKw);
    setSubmittedKeyword(nextKw.trim());
  };

  const handleResetFilters = () => {
    setKeyword('');
    setSubmittedKeyword('');
    setCategory('all');
    setLanguage('');
  };

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
      Taro.showToast({ title: '操作失败，请重试', icon: 'none' });
    }
  };

  const hasActiveFilter = Boolean(submittedKeyword || category !== 'all' || language);

  return (
    <View className='gp-discover'>
      <NavBar title='发现' subtitle='历史收录库' />

      <View className='gp-discover__body'>
        {/* Search Box */}
        <View className='gp-search-box'>
          <Text className='gp-search-box__icon'>⌕</Text>
          <Input
            className='gp-search-box__input'
            value={keyword}
            placeholder='搜项目名、AI 摘要、标签或技术栈'
            placeholderClass='gp-search-box__placeholder'
            confirmType='search'
            onInput={(e) => {
              const val = e.detail.value;
              setKeyword(val);
              if (!val.trim()) {
                setSubmittedKeyword('');
              }
            }}
            onConfirm={() => setSubmittedKeyword(keyword.trim())}
          />
          {keyword.length > 0 && (
            <View
              className='gp-search-box__clear'
              role='button'
              aria-label='清空搜索词'
              onClick={() => handleApplyKeyword('')}
            >
              <Text>×</Text>
            </View>
          )}
          <View
            className='gp-search-box__submit'
            hoverClass='gp-search-box__submit--active'
            role='button'
            onClick={() => setSubmittedKeyword(keyword.trim())}
          >
            <Text>搜索</Text>
          </View>
        </View>

        {/* Hot Queries */}
        <View className='gp-hot-queries'>
          <Text className='gp-hot-queries__label'>热搜</Text>
          <View className='gp-hot-queries__list'>
            {HOT_KEYWORDS.map((word) => {
              const active = submittedKeyword.toLowerCase() === word.toLowerCase();
              return (
                <View
                  key={word}
                  className={`gp-hot-tag ${active ? 'gp-hot-tag--active' : ''}`}
                  role='button'
                  onClick={() => handleApplyKeyword(active ? '' : word)}
                >
                  <Text>{word}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Category Filter */}
        <ScrollView scrollX enableFlex showScrollbar={false} className='gp-filter-strip'>
          <View className='gp-filter-strip__inner'>
            {CATEGORIES.map((cat) => (
              <View
                key={cat.id}
                className={`gp-filter-pill ${category === cat.id ? 'gp-filter-pill--active' : ''}`}
                role='button'
                onClick={() => setCategory(cat.id)}
              >
                <Text>{cat.label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* Language Filter */}
        <ScrollView scrollX enableFlex showScrollbar={false} className='gp-filter-strip gp-filter-strip--lang'>
          <View className='gp-filter-strip__inner'>
            <View
              className={`gp-lang-pill ${language === '' ? 'gp-lang-pill--active' : ''}`}
              role='button'
              onClick={() => setLanguage('')}
            >
              <Text>全部语言</Text>
            </View>
            {languages.map((lang) => (
              <View
                key={lang}
                className={`gp-lang-pill ${language === lang ? 'gp-lang-pill--active' : ''}`}
                role='button'
                onClick={() => setLanguage(language === lang ? '' : lang)}
              >
                <Text>{lang}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* Result Header */}
        <View className='gp-discover__meta'>
          <Text className='gp-discover__count gp-tabular'>
            {loading ? '正在检索历史收录库…' : `共收录命中 ${total} 个项目`}
          </Text>
          {hasActiveFilter && (
            <View
              className='gp-discover__reset'
              role='button'
              onClick={handleResetFilters}
            >
              <Text>清空筛选</Text>
            </View>
          )}
        </View>

        {/* Results */}
        {loading ? (
          <SkeletonCard count={3} />
        ) : errorMsg ? (
          <StateView
            variant='error'
            title='检索暂时不可用'
            description={errorMsg}
            actionText='重新检索'
            onAction={() => runSearch(1, false)}
          />
        ) : items.length === 0 ? (
          <StateView
            variant='empty'
            title='没有找到匹配的开源项目'
            description='试试更换更短的关键词，或清空分类与语言筛选查看全部收录仓库。'
            actionText='重置全部筛选'
            onAction={handleResetFilters}
          />
        ) : (
          <View>
            {items.map((repo) => (
              <RepoCard
                key={repo._id}
                repo={repo}
                periodLabel='热榜'
                bookmarked={bookmarkedSet.has(repo._id)}
                onSelect={handleOpenDetail}
                onToggleBookmark={handleToggleBookmark}
              />
            ))}

            {hasMore ? (
              <View
                className='gp-load-more'
                hoverClass='gp-load-more--active'
                role='button'
                onClick={() => {
                  if (!loadingMore) {
                    runSearch(page + 1, true);
                  }
                }}
              >
                <Text>{loadingMore ? '正在加载更多…' : '加载更多收录项目'}</Text>
              </View>
            ) : (
              <View className='gp-discover__end'>
                <Text>— 已显示全部匹配结果 —</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

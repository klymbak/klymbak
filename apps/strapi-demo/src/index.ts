import type { Core } from '@strapi/strapi';
import seedJson from '../data/seed.json';

type Block = { __component: 'shared.quote'; title: string; body: string } | { __component: 'shared.rich-text'; body: string };

interface Seed {
  global: { siteName: string; siteDescription: string; defaultSeo: { metaTitle: string; metaDescription: string } };
  about: { title: string; blocks: Block[] };
  categories: { name: string; slug: string; description?: string }[];
  authors: { key: string; name: string; email: string }[];
  articles: {
    title: string;
    slug: string;
    description?: string;
    category?: string;
    author: string;
    /** "modified": published, then changed again in the draft. */
    status: 'draft' | 'published' | 'modified';
    quote?: { title: string; body: string };
    body: string;
    draftBody?: string;
  }[];
}

const seed = seedJson as Seed;
const ARTICLE = 'api::article.article';

/** Fills an empty database with the demo blog: categories, authors, articles, Global and About. */
async function seedContent(strapi: Core.Strapi) {
  if ((await strapi.documents(ARTICLE).count({})) > 0) return;
  strapi.log.info('[demo] Seeding the Field Notes blog');

  const categories = new Map<string, string>();
  for (const category of seed.categories) {
    const created = await strapi.documents('api::category.category').create({ data: category });
    categories.set(category.name, created.documentId);
  }

  const authors = new Map<string, string>();
  for (const { key, ...author } of seed.authors) {
    const created = await strapi.documents('api::author.author').create({ data: author });
    authors.set(key, created.documentId);
  }

  for (const article of seed.articles) {
    const blocks = (body: string): Block[] => [
      ...(article.quote ? [{ __component: 'shared.quote' as const, ...article.quote }] : []),
      { __component: 'shared.rich-text', body },
    ];
    const created = await strapi.documents(ARTICLE).create({
      data: {
        title: article.title,
        slug: article.slug,
        description: article.description,
        category: article.category ? categories.get(article.category) : undefined,
        author: authors.get(article.author),
        blocks: blocks(article.body),
      },
    });
    if (article.status === 'draft') continue;
    await strapi.documents(ARTICLE).publish({ documentId: created.documentId });
    if (article.status === 'modified' && article.draftBody) {
      await strapi.documents(ARTICLE).update({ documentId: created.documentId, data: { blocks: blocks(article.draftBody) } });
    }
  }

  await strapi.documents('api::global.global').create({ data: seed.global });
  await strapi.documents('api::about.about').create({ data: seed.about });
}

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await seedContent(strapi);
  },
};

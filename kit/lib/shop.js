// What the KIT reads from the shop through the Admin API (ctx.graphql, the Orders page's direct API access): products
// by handle (template, first SKU, options, tags, photo, design metafields) and the shop metafields custom.cc_files /
// custom.cc_previews / custom.cc_shirt_map. Every answer is kept on the ctx, so a product is read once per download.
// Each document was checked against the Admin schema (Shopify connector, 15 Oct 2026, read-only).
import { cdnBaseOf } from './links.js';

export const PRODUCT_QUERY = `query KitProduct($handle: String!) {
  productByIdentifier(identifier: { handle: $handle }) {
    id
    handle
    title
    templateSuffix
    tags
    options { name values }
    variants(first: 1, sortKey: POSITION) { nodes { sku } }
    featuredMedia { preview { image { url } } }
    designFile: metafield(namespace: "custom", key: "design_file") {
      type
      reference {
        __typename
        ... on MediaImage { image { url } }
        ... on GenericFile { url }
      }
    }
    designMono: metafield(namespace: "custom", key: "design_mono") { type value }
    designInk: metafield(namespace: "custom", key: "design_ink") { type value }
    garment: metafield(namespace: "custom", key: "garment") { type value }
  }
}`;

export const SHOP_QUERY = `query KitShop {
  shop {
    name
    ccFiles: metafield(namespace: "custom", key: "cc_files") { value }
    ccPreviews: metafield(namespace: "custom", key: "cc_previews") { value }
    ccShirtMap: metafield(namespace: "custom", key: "cc_shirt_map") { value }
  }
}`;

// the KIT's own cache on a ctx
export function kitOf(ctx) {
  if (!ctx || typeof ctx !== 'object') throw new Error('KIT: no ctx');
  if (!ctx.__kit) Object.defineProperty(ctx, '__kit', { value: { products: new Map(), shop: null, cdnBase: '' }, enumerable: false });
  return ctx.__kit;
}

export async function gql(ctx, query, variables) {
  if (typeof ctx.graphql !== 'function') throw new Error('KIT: ctx.graphql is needed to read products');
  const r = await ctx.graphql(query, variables || {});
  if (r && Array.isArray(r.errors) && r.errors.length) throw new Error(`Shopify: ${r.errors.map((e) => e.message).join('; ')}`);
  // the whole answer ({ data, errors }) or just its data
  return r && typeof r === 'object' && 'data' in r ? r.data : r;
}

// remembers the shop's CDN folder from any of its file URLs
export function seeUrl(ctx, url) {
  const k = kitOf(ctx);
  if (!k.cdnBase) {
    const b = cdnBaseOf(url);
    if (b) k.cdnBase = b;
  }
}

// the shop's CDN folder (https://cdn.shopify.com/s/files/1/<shop id>/), from ctx.cdnBase or any URL seen so far
export function cdnBase(ctx) {
  const k = kitOf(ctx);
  const given = ctx.cdnBase ? String(ctx.cdnBase).replace(/\/?$/, '/') : '';
  return given || k.cdnBase || '';
}

// a product by handle -> the facts the theme's Liquid reads, or null (no such product)
export function productByHandle(handle, ctx) {
  const k = kitOf(ctx);
  if (typeof ctx.product === 'function' && !k.products.has(handle)) k.products.set(handle, Promise.resolve(ctx.product(handle)).then(norm));
  if (!k.products.has(handle))
    k.products.set(
      handle,
      gql(ctx, PRODUCT_QUERY, { handle }).then((d) => norm(d && d.productByIdentifier))
    );
  const p = k.products.get(handle);
  p.catch(() => k.products.delete(handle));
  return p.then((f) => {
    if (f) {
      if (f.image) seeUrl(ctx, f.image);
      if (f.designFile && f.designFile.url) seeUrl(ctx, f.designFile.url);
    }
    return f;
  });
}

// Admin product (PRODUCT_QUERY shape) or already plain facts -> plain facts
function norm(p) {
  if (!p) return null;
  if (p.__facts) return p;
  const ref = p.designFile && p.designFile.reference;
  let designFile = null;
  if (ref) {
    if (ref.__typename === 'MediaImage') designFile = { media: 'image', url: (ref.image && ref.image.url) || '' };
    else if (ref.__typename === 'GenericFile') designFile = { media: 'file', url: ref.url || '' };
    else designFile = { media: String(ref.__typename || 'other').toLowerCase(), url: '' };
  }
  const variants = (p.variants && p.variants.nodes) || [];
  const meta = (m) => (m ? { type: m.type, value: m.value } : null);
  return {
    __facts: true,
    handle: p.handle,
    title: p.title || '',
    templateSuffix: p.templateSuffix || '',
    tags: p.tags || [],
    options: (p.options || []).map((o) => ({ name: o.name, values: o.values || [] })),
    firstSku: variants.length ? variants[0].sku : null,
    image: (p.featuredMedia && p.featuredMedia.preview && p.featuredMedia.preview.image && p.featuredMedia.preview.image.url) || p.image || '',
    designFile,
    designMono: meta(p.designMono),
    designInk: meta(p.designInk),
    garment: meta(p.garment),
  };
}

function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'object' && 'value' in v && !('p' in v)) v = v.value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch (e) {
      return null;
    }
  }
  return v && typeof v === 'object' ? v : null;
}

// the shop metafields: { ccFiles, ccPreviews, ccShirtMap, name } (ctx's own copies first)
export async function shopData(ctx) {
  const k = kitOf(ctx);
  const have = ctx.ccFiles !== undefined && ctx.ccPreviews !== undefined;
  if (!k.shop) {
    k.shop = (have ? Promise.resolve({}) : gql(ctx, SHOP_QUERY).then((d) => (d && d.shop) || {})).then((s) => ({
      name: ctx.shopName || s.name || '',
      ccFiles: parseJson(ctx.ccFiles !== undefined ? ctx.ccFiles : s.ccFiles),
      ccPreviews: parseJson(ctx.ccPreviews !== undefined ? ctx.ccPreviews : s.ccPreviews),
      ccShirtMap: parseJson(ctx.ccShirtMap !== undefined ? ctx.ccShirtMap : s.ccShirtMap),
    }));
    k.shop.catch(() => {
      k.shop = null;
    });
  }
  return k.shop;
}

// a file in the shop's Files by name -> its CDN URL (what Liquid's file_url gives, on cdn.shopify.com)
export function fileUrl(ctx, name) {
  const base = cdnBase(ctx);
  if (!base) throw new Error("KIT: the shop's CDN folder isn't known (pass ctx.cdnBase, or read a product first)");
  return `${base}files/${encodeURIComponent(String(name))}`;
}

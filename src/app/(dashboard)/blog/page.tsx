import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-server";
import { checkPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { blogPost, blogCategory } from "@/lib/db/schema/blog";
import { user } from "@/lib/db/schema/users";
import { eq, asc, desc } from "drizzle-orm";
import { BlogList } from "@/components/blog/blog-list";
import type { UserRole } from "@/types";

export const metadata: Metadata = { title: "Blog Interno" };

export default async function BlogPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const userRole = ((session.user as { role?: string }).role ?? "operational") as UserRole;

  const [canView, canEdit, canDelete] = await Promise.all([
    checkPermission(session.user.id, userRole, "blog", "view"),
    checkPermission(session.user.id, userRole, "blog", "edit"),
    checkPermission(session.user.id, userRole, "blog", "delete"),
  ]);

  if (!canView) redirect("/");

  const [categories, posts] = await Promise.all([
    db
      .select()
      .from(blogCategory)
      .orderBy(asc(blogCategory.order), asc(blogCategory.name)),
    db
      .select({
        id: blogPost.id,
        title: blogPost.title,
        slug: blogPost.slug,
        excerpt: blogPost.excerpt,
        type: blogPost.type,
        coverImageUrl: blogPost.coverImageUrl,
        categoryId: blogPost.categoryId,
        categoryName: blogCategory.name,
        authorId: blogPost.authorId,
        authorName: user.name,
        isPublished: blogPost.isPublished,
        publishedAt: blogPost.publishedAt,
        createdAt: blogPost.createdAt,
        updatedAt: blogPost.updatedAt,
      })
      .from(blogPost)
      .leftJoin(blogCategory, eq(blogPost.categoryId, blogCategory.id))
      .leftJoin(user, eq(blogPost.authorId, user.id))
      .orderBy(desc(blogPost.updatedAt)),
  ]);

  const serializedPosts = posts.map((p) => ({
    ...p,
    categoryName: p.categoryName ?? null,
    authorName: p.authorName ?? null,
    excerpt: p.excerpt ?? null,
    coverImageUrl: p.coverImageUrl ?? null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h1 text-foreground">Blog Interno</h1>
        <p className="text-muted mt-1">Base de conhecimento e artigos da equipe</p>
      </div>

      <BlogList
        initialCategories={categories}
        initialPosts={serializedPosts}
        canEdit={canEdit}
        canDelete={canDelete}
        currentUserId={session.user.id}
      />
    </div>
  );
}

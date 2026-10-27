type PendingSave = () => Promise<boolean>;

const editors = new Set<PendingSave>();

/** 编辑器退出身份前可主动提交；卸载后不再参与之后的账号操作。 */
export function registerPendingSave(save: PendingSave): () => void {
  editors.add(save);
  return () => {
    editors.delete(save);
  };
}

/** 任意草稿保存失败都保留当前身份与编辑界面，由调用方决定是否继续退出。 */
export async function flushPendingSaves(): Promise<boolean> {
  const results = await Promise.allSettled(
    [...editors].map(async (save) => {
      if (!editors.has(save)) return true;
      return save();
    }),
  );
  return results.every((result) => result.status === 'fulfilled' && result.value === true);
}

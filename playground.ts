type Something = (
  args_0: string,
  args_1: number,
) => {
  bump: () => number;
  describe: () => string;
};

type SomethingReturn = ReturnType<Something>;
type SomethingParams = Parameters<Something>;

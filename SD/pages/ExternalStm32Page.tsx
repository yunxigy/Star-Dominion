import { Link } from 'react-router-dom';

export function Stm32Page() {
  const target = import.meta.env.VITE_STM32_URL?.trim();
  return (
    <section className="mx-auto max-w-lg space-y-5 p-8">
      <h1 className="text-2xl font-bold">STM32 上位机</h1>
      <p>{target ? '前往上位机查看设备状态和实时数据。' : '上位机入口暂不可用，请联系管理员。'}</p>
      {target && <a href={target} className="inline-block rounded-lg bg-[#392b20] px-5 py-3 text-white">打开上位机</a>}
      <Link to="/" className="block underline">返回工具箱</Link>
    </section>
  );
}

export default Stm32Page;

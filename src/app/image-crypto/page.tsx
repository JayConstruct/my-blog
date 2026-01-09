'use client'

import { useCallback, useState, type DragEvent } from 'react'
import { motion } from 'motion/react'
import { ANIMATION_DELAY, INIT_DELAY } from '@/consts'

// 定义简单的图片状态类型
type CryptoImage = {
	file: File
	preview: string
	status: 'pending' | 'encrypted' | 'decrypted'
}

export default function Page() {
	const [images, setImages] = useState<CryptoImage[]>([])
	const [isDragging, setIsDragging] = useState(false)
	const hasImages = images.length > 0

	// 处理文件选择
	const handleFiles = useCallback((fileList: FileList | null) => {
		if (!fileList?.length) return
		// 暂时只允许选图片，后续如果加密文件可能不限制类型
		const files = Array.from(fileList)
		
		const nextItems = files.map(file => ({
			file,
			preview: URL.createObjectURL(file), // 创建本地预览
			status: 'pending' as const
		}))

		setImages(prev => [...prev, ...nextItems])
	}, [])

	// 拖拽相关事件处理
	const handleDragEnter = useCallback((e: DragEvent<HTMLLabelElement>) => {
		e.preventDefault(); e.stopPropagation(); setIsDragging(true)
	}, [])
	const handleDragOver = useCallback((e: DragEvent<HTMLLabelElement>) => {
		e.preventDefault(); e.stopPropagation()
	}, [])
	const handleDragLeave = useCallback((e: DragEvent<HTMLLabelElement>) => {
		e.preventDefault(); e.stopPropagation(); setIsDragging(false)
	}, [])
	const handleDrop = useCallback((e: DragEvent<HTMLLabelElement>) => {
		e.preventDefault(); e.stopPropagation(); setIsDragging(false)
		handleFiles(e.dataTransfer?.files ?? null)
	}, [handleFiles])

	// 移除图片
	const handleRemove = useCallback((index: number) => {
		setImages(prev => {
			const next = [...prev]
			URL.revokeObjectURL(next[index].preview) // 释放内存
			next.splice(index, 1)
			return next
		})
	}, [])

	// 占位函数：后续在此处添加 AES 算法
	const handleProcess = useCallback((type: 'encrypt' | 'decrypt') => {
		alert(`准备执行${type === 'encrypt' ? '加密' : '解密'}操作\n（算法逻辑待添加）`)
	}, [])

	return (
		<div className='relative px-6 pt-32 pb-12 text-sm max-sm:pt-28'>
			<div className='mx-auto flex max-w-3xl flex-col gap-6'>
				
				{/* 标题区域 */}
				<motion.div
					initial={{ opacity: 0, scale: 0.9 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ delay: INIT_DELAY }}
					className='space-y-2 text-center'>
					<p className='text-secondary text-xs tracking-[0.2em] uppercase'>Secure Box</p>
					<h1 className='text-2xl font-semibold'>图片本地加解密</h1>
					<p className='text-secondary'>纯前端 AES 加密，数据不上传服务器</p>
				</motion.div>

				{/* 拖拽上传区域 */}
				<motion.label
					initial={{ opacity: 0, scale: 0.9 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ delay: INIT_DELAY + ANIMATION_DELAY }}
					onDragEnter={handleDragEnter}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
					className={`group card relative flex cursor-pointer flex-col items-center justify-center gap-3 text-center transition-colors hover:bg-white/80 ${
						isDragging ? 'border-brand bg-white' : 'hover:border-brand/20'
					}`}>
					<input type='file' accept='image/*' multiple className='hidden' onChange={e => handleFiles(e.target.files)} />
					<div className='bg-brand/10 text-brand/60 group-hover:bg-brand/10 flex h-20 w-20 items-center justify-center rounded-full text-3xl transition'>
						🔒
					</div>
					<div>
						<p className='text-base font-medium'>点击或拖拽图片文件</p>
						<p className='text-secondary text-xs'>支持任意图片格式，处理过程完全在本地完成</p>
					</div>
				</motion.label>

				{/* 图片列表与操作区 */}
				{hasImages && (
					<motion.div 
						initial={{ opacity: 0, scale: 0.9 }} 
						animate={{ opacity: 1, scale: 1 }} 
						className='card relative space-y-4'
					>
						{/* 操作栏 */}
						<div className='flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4'>
							<div className='text-xs font-medium text-slate-500 uppercase tracking-wider'>
								已选 {images.length} 个文件
							</div>
							<div className='flex gap-2'>
								<button
									onClick={() => handleProcess('encrypt')}
									className='rounded-full bg-slate-900 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 active:scale-95'
								>
									一键加密
								</button>
								<button
									onClick={() => handleProcess('decrypt')}
									className='rounded-full border border-slate-200 px-4 py-1.5 text-xs font-medium transition hover:bg-slate-50 active:scale-95'
								>
									一键解密
								</button>
							</div>
						</div>

						{/* 列表 */}
						<ul className='divide-y divide-slate-200'>
							{images.map((item, index) => (
								<li key={index} className='flex items-center gap-4 py-3'>
									<div className='h-12 w-12 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200'>
										<img src={item.preview} alt="preview" className='h-full w-full object-cover opacity-80' />
									</div>
									<div className='flex-1 truncate'>
										<p className='font-medium truncate'>{item.file.name}</p>
										<p className='text-xs text-slate-400'>{(item.file.size / 1024).toFixed(1)} KB</p>
									</div>
									<button
										onClick={() => handleRemove(index)}
										className='text-xs text-rose-400 hover:text-rose-600 hover:underline'
									>
										移除
									</button>
								</li>
							))}
						</ul>
					</motion.div>
				)}
			</div>
		</div>
	)
}

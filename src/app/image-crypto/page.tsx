'use client'

import { useCallback, useEffect, useState, useRef, type DragEvent } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ANIMATION_DELAY, INIT_DELAY } from '@/consts'
import { GilbertAlgo } from '@/lib/crypto/gilbert'
import { BlockShuffleAlgo } from '@/lib/crypto/block-shuffle'
import JSZip from 'jszip'
import { toast } from 'sonner' // 假设你项目中用了 sonner 或其他 toast 库，如果没有请换成 alert

// --- 类型定义 ---
type AlgoType = 'gilbert' | 'block'

interface ProcessingOptions {
	algo: AlgoType
	blockLevel: number
	blockKey: string
}

interface ImageItem {
	id: string
	file: File
	preview: string
	resultPreview?: string
	resultBlob?: Blob
	status: 'idle' | 'processing' | 'done' | 'error'
}

// --- 组件 ---

export default function Page() {
	// 全局状态
	const [images, setImages] = useState<ImageItem[]>([])
	const [dragActive, setDragActive] = useState(false)
	
	// 算法配置
	const [algo, setAlgo] = useState<AlgoType>('gilbert')
	const [blockLevel, setBlockLevel] = useState(40)
	const [blockKey, setBlockKey] = useState('')
	const [isProcessing, setIsProcessing] = useState(false)

	// 右键菜单状态
	const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetId: string } | null>(null)

	// 关闭右键菜单
	useEffect(() => {
		const handleClick = () => setContextMenu(null)
		window.addEventListener('click', handleClick)
		return () => window.removeEventListener('click', handleClick)
	}, [])

	// 处理文件上传
	const handleFiles = useCallback((fileList: FileList | null) => {
		if (!fileList?.length) return
		const newImages: ImageItem[] = Array.from(fileList).map(file => ({
			id: Math.random().toString(36).slice(2),
			file,
			preview: URL.createObjectURL(file),
			status: 'idle'
		}))
		setImages(prev => [...prev, ...newImages])
	}, [])

	// 核心处理逻辑 (使用 setTimeout 避免阻塞 UI)
	const processImage = async (item: ImageItem, mode: 'encrypt' | 'decrypt', options: ProcessingOptions) => {
		return new Promise<ImageItem>((resolve) => {
			setTimeout(() => {
				try {
					const canvas = document.createElement('canvas')
					const ctx = canvas.getContext('2d', { willReadFrequently: true })
					if (!ctx) throw new Error('Canvas init failed')

					const img = new Image()
					img.src = item.preview
					
					img.onload = () => {
						canvas.width = img.width
						canvas.height = img.height
						ctx.drawImage(img, 0, 0)

						// 执行算法
						if (options.algo === 'gilbert') {
							const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
							const resultData = GilbertAlgo.process(imageData, mode)
							ctx.putImageData(resultData, 0, 0)
						} else {
							BlockShuffleAlgo.process(ctx, canvas.width, canvas.height, options.blockLevel, options.blockKey, mode)
						}

						// 导出结果
						canvas.toBlob(blob => {
							if (blob) {
								resolve({
									...item,
									status: 'done',
									resultBlob: blob,
									resultPreview: URL.createObjectURL(blob)
								})
							} else {
								resolve({ ...item, status: 'error' })
							}
						}, 'image/jpeg', 0.95)
					}
					
					img.onerror = () => resolve({ ...item, status: 'error' })
				} catch (e) {
					console.error(e)
					resolve({ ...item, status: 'error' })
				}
			}, 50) // 给 UI 一点渲染时间
		})
	}

	// 批量执行
	const handleRun = async (mode: 'encrypt' | 'decrypt') => {
		if (images.length === 0) return
		setIsProcessing(true)

		const options: ProcessingOptions = { algo, blockLevel, blockKey }
		const queue = [...images]
		
		// 逐个处理，如果要并发可以用 Promise.all，但大图并发可能会卡
		const results = []
		for (const item of queue) {
			// 更新状态为 processing
			setImages(prev => prev.map(p => p.id === item.id ? { ...p, status: 'processing' } : p))
			
			const res = await processImage(item, mode, options)
			results.push(res)
			
			// 更新单个结果
			setImages(prev => prev.map(p => p.id === item.id ? res : p))
		}

		setIsProcessing(false)
		toast.success('全部处理完成')
	}

	// 单个操作：还原
	const handleResetItem = (id: string) => {
		setImages(prev => prev.map(item => {
			if (item.id !== id) return item
			if (item.resultPreview) URL.revokeObjectURL(item.resultPreview)
			return { ...item, status: 'idle', resultPreview: undefined, resultBlob: undefined }
		}))
	}

	// 单个操作：删除
	const handleRemoveItem = (id: string) => {
		setImages(prev => {
			const target = prev.find(p => p.id === id)
			if (target?.preview) URL.revokeObjectURL(target.preview)
			if (target?.resultPreview) URL.revokeObjectURL(target.resultPreview)
			return prev.filter(p => p.id !== id)
		})
	}

    // 单个操作：对单个图片重新执行当前算法
    const handleReprocessSingle = async (id: string, mode: 'encrypt' | 'decrypt') => {
        const target = images.find(p => p.id === id)
        if (!target) return
        setImages(prev => prev.map(p => p.id === id ? { ...p, status: 'processing' } : p))
        const res = await processImage(target, mode, { algo, blockLevel, blockKey })
        setImages(prev => prev.map(p => p.id === id ? res : p))
    }

	// 打包下载
	const handleDownloadAll = async () => {
		const processed = images.filter(i => i.status === 'done' && i.resultBlob)
		if (processed.length === 0) return

		const zip = new JSZip()
		const folder = zip.folder("encrypted_images")
		
		processed.forEach((item, idx) => {
			const ext = algo === 'gilbert' ? 'pixel' : 'block'
			const name = item.file.name.replace(/\.[^/.]+$/, "")
			folder?.file(`${name}_${ext}_${idx}.jpg`, item.resultBlob!)
		})

		const content = await zip.generateAsync({ type: "blob" })
		const link = document.createElement('a')
		link.href = URL.createObjectURL(content)
		link.download = "images_archive.zip"
		link.click()
	}

	// 拖拽事件
	const onDrag = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); }
	const onDragEnter = (e: DragEvent) => { onDrag(e); setDragActive(true); }
	const onDragLeave = (e: DragEvent) => { onDrag(e); setDragActive(false); }
	const onDrop = (e: DragEvent) => { onDrag(e); setDragActive(false); handleFiles(e.dataTransfer.files); }

	// 渲染模式
	const isSingleMode = images.length === 1

	return (
		<div className='relative min-h-screen px-6 pt-32 pb-20 text-sm max-sm:pt-28' onDragEnter={onDragEnter} onDragOver={onDrag} onDragLeave={onDragLeave} onDrop={onDrop}>
			
			{/* --- 顶部控制区 --- */}
			<div className='mx-auto max-w-5xl space-y-6'>
				<motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className='text-center'>
					<h1 className='text-2xl font-bold text-slate-800'>本地图片加解密</h1>
					<p className='text-secondary mt-1'>纯前端处理，数据不上传</p>
				</motion.div>

				<motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className='card mx-auto max-w-3xl p-1'>
					<div className='flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between'>
						{/* 算法选择 */}
						<div className='flex items-center gap-2 rounded-lg bg-slate-100 p-1'>
							<button onClick={() => setAlgo('gilbert')} className={`rounded-md px-4 py-1.5 transition-all ${algo === 'gilbert' ? 'bg-white font-medium shadow-sm text-brand' : 'text-slate-500 hover:text-slate-700'}`}>
								像素混淆 (Gilbert)
							</button>
							<button onClick={() => setAlgo('block')} className={`rounded-md px-4 py-1.5 transition-all ${algo === 'block' ? 'bg-white font-medium shadow-sm text-brand' : 'text-slate-500 hover:text-slate-700'}`}>
								宫格拼图 (Block)
							</button>
						</div>

						{/* 参数设置 */}
						<div className='flex flex-1 flex-wrap items-center justify-end gap-3'>
							{algo === 'block' && (
								<>
									<div className='flex items-center gap-2' title="切分等级">
										<span className='text-xs font-bold text-slate-400'>Lv.</span>
										<input type="number" min={2} max={200} value={blockLevel} onChange={e => setBlockLevel(Number(e.target.value))} className='w-14 rounded border border-slate-200 px-2 py-1 text-center text-xs' />
									</div>
									<input type="text" placeholder="密钥 (可选)" value={blockKey} onChange={e => setBlockKey(e.target.value)} className='w-28 rounded border border-slate-200 px-2 py-1 text-xs' />
								</>
							)}
						</div>
					</div>
					
					{/* 操作按钮栏 */}
					<div className='flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-5 py-3'>
                        <div className="flex gap-2">
                             <label className='cursor-pointer rounded-full border border-dashed border-slate-300 px-4 py-1.5 text-xs font-medium hover:border-brand hover:text-brand transition-colors bg-white'>
                                <span>+ 添加图片</span>
                                <input type='file' accept='image/*' multiple className='hidden' onChange={e => handleFiles(e.target.files)} />
                            </label>
                            {images.length > 0 && (
                                <button onClick={() => setImages([])} className='text-xs text-rose-400 hover:text-rose-600 px-2'>清空</button>
                            )}
                        </div>
						
						<div className='flex gap-2'>
							<button onClick={() => handleRun('encrypt')} disabled={isProcessing || !images.length} className='rounded-full bg-slate-800 px-5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-50'>
								{isProcessing ? '处理中...' : '加密'}
							</button>
							<button onClick={() => handleRun('decrypt')} disabled={isProcessing || !images.length} className='rounded-full border border-slate-200 bg-white px-5 py-1.5 text-xs font-medium transition hover:bg-slate-50 disabled:opacity-50'>
								解密
							</button>
                            {images.some(i => i.status === 'done') && (
                                <button onClick={handleDownloadAll} className='rounded-full border border-brand/20 bg-brand/5 text-brand px-4 py-1.5 text-xs font-medium hover:bg-brand/10'>
                                    打包下载
                                </button>
                            )}
						</div>
					</div>
				</motion.div>
			</div>

			{/* --- 图片展示区 --- */}
			<div className='mx-auto mt-8 max-w-[1400px]'>
				{!images.length ? (
                    // 空状态
					<div className={`flex h-64 flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-colors ${dragActive ? 'border-brand bg-brand/5' : 'border-slate-200'}`}>
						<p className='text-slate-400'>拖拽图片到这里，或者点击上方的“添加图片”</p>
					</div>
				) : isSingleMode ? (
					// 单图模式 (大图对比)
					<motion.div layout className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
						<div className='card flex flex-col gap-2 p-4'>
							<span className='text-xs font-bold uppercase text-slate-400'>Original</span>
							<img src={images[0].preview} className='h-[60vh] w-full rounded-lg object-contain bg-slate-100/50' alt="Original" />
						</div>
						<div 
                            className='card flex flex-col gap-2 p-4 relative'
                            onContextMenu={(e) => {
                                e.preventDefault()
                                if(images[0].status === 'done') setContextMenu({ x: e.clientX, y: e.clientY, targetId: images[0].id })
                            }}
                        >
							<span className='text-xs font-bold uppercase text-slate-400'>Processed Result</span>
							{images[0].status === 'done' ? (
								<img src={images[0].resultPreview} className='h-[60vh] w-full rounded-lg object-contain bg-slate-100/50' alt="Result" />
							) : images[0].status === 'processing' ? (
								<div className='flex h-[60vh] items-center justify-center text-slate-400'>处理中...</div>
							) : (
								<div className='flex h-[60vh] items-center justify-center text-slate-300'>等待处理</div>
							)}
                            {/* 右键提示 */}
                            {images[0].status === 'done' && <div className="absolute bottom-4 right-4 text-xs text-slate-400 bg-white/80 px-2 py-1 rounded backdrop-blur">右键可操作</div>}
						</div>
					</motion.div>
				) : (
					// 多图模式 (网格列表)
					<motion.div layout className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
						<AnimatePresence>
							{images.map(item => (
								<motion.div
									key={item.id}
									layout
									initial={{ opacity: 0, scale: 0.9 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, scale: 0.9 }}
									className='card group relative overflow-hidden p-3'
                                    onContextMenu={(e) => {
                                        e.preventDefault()
                                        if(item.status === 'done') setContextMenu({ x: e.clientX, y: e.clientY, targetId: item.id })
                                    }}
								>
									<div className='flex gap-2 h-48'>
										<div className='relative flex-1 bg-slate-50 rounded-lg overflow-hidden'>
                                            <img src={item.preview} className='h-full w-full object-cover' />
                                            <div className="absolute top-2 left-2 text-[10px] bg-black/50 text-white px-1.5 py-0.5 rounded">原图</div>
                                        </div>
										<div className='relative flex-1 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center'>
											{item.status === 'done' ? (
												<img src={item.resultPreview} className='h-full w-full object-cover' />
											) : item.status === 'processing' ? (
												<span className='animate-pulse text-xs text-slate-400'>...</span>
											) : (
												<span className='text-xs text-slate-300'>待处理</span>
											)}
                                            {item.status === 'done' && <div className="absolute top-2 right-2 text-[10px] bg-brand text-white px-1.5 py-0.5 rounded">结果</div>}
										</div>
									</div>
                                    <div className="mt-2 flex items-center justify-between">
                                        <p className="text-xs text-slate-500 truncate max-w-[150px]">{item.file.name}</p>
                                        <button onClick={() => handleRemoveItem(item.id)} className="text-xs text-rose-300 hover:text-rose-500">移除</button>
                                    </div>
								</motion.div>
							))}
						</AnimatePresence>
					</motion.div>
				)}
			</div>

			{/* --- 自定义右键菜单 --- */}
			{contextMenu && (
				<div
					className='fixed z-50 min-w-[120px] overflow-hidden rounded-lg border border-slate-100 bg-white shadow-xl'
					style={{ left: contextMenu.x, top: contextMenu.y }}
					onClick={(e) => e.stopPropagation()}
				>
					<div className='flex flex-col py-1'>
						<button 
                            onClick={() => { handleReprocessSingle(contextMenu.targetId, 'encrypt'); setContextMenu(null) }}
                            className='px-4 py-2 text-left text-xs hover:bg-slate-50'
                        >
							使用当前配置重制 (加密)
						</button>
                        <button 
                            onClick={() => { handleReprocessSingle(contextMenu.targetId, 'decrypt'); setContextMenu(null) }}
                            className='px-4 py-2 text-left text-xs hover:bg-slate-50'
                        >
							使用当前配置重制 (解密)
						</button>
						<button 
                            onClick={() => { handleResetItem(contextMenu.targetId); setContextMenu(null) }}
                            className='border-t border-slate-100 px-4 py-2 text-left text-xs hover:bg-slate-50'
                        >
							还原/重置
						</button>
						<button 
                            onClick={() => { handleRemoveItem(contextMenu.targetId); setContextMenu(null) }}
                            className='px-4 py-2 text-left text-xs text-rose-500 hover:bg-rose-50'
                        >
							删除图片
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
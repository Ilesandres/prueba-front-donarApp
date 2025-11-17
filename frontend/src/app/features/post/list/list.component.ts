import { Component, OnInit, OnDestroy, HostListener, Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { Subject, takeUntil, forkJoin, debounceTime, distinctUntilChanged, take } from 'rxjs';
import { PostsService, Post, TypePost, FilterPostDTO, PostLiked } from '../../../core/services/posts.service';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { SidebarComponent } from '../../../shared/components/sidebar/sidebar.component';
import { AuthService } from '../../../core/services/auth.service';
import { AlertService } from '../../../shared/services/alert.service';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { FormsModule } from '@angular/forms';
import { CommentFormComponent } from '../../../shared/components/comment-form/comment-form.component';
import { CommentListComponent } from '../../../shared/components/comment-list/comment-list.component';
import { ReportService } from '../../../core/services/report.service';
import { ToastService } from '../../../core/services/toast.service';

@Pipe({ name: 'safeUrl' })
export class SafeUrlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}
  transform(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
}

@Component({
  selector: 'app-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ButtonComponent,
    SidebarComponent,
    SafeUrlPipe,
    SpinnerComponent,
    FormsModule,
    CommentFormComponent,
    CommentListComponent
  ],
  templateUrl: './list.component.html',
  styleUrl: './list.component.scss'
})
export class ListComponent implements OnInit, OnDestroy {
    // Detecta si una url es PDF
    isPdfFile(url: string): boolean {
      if (!url) return false;
      const u = url.toLowerCase();
      return u.endsWith('.pdf') || u.includes('.pdf?') || u.startsWith('data:application/pdf');
    }

    isVideoFile(url: string): boolean {
      if (!url) return false;
      const u = url.toLowerCase();
      return u.endsWith('.mp4') || u.endsWith('.webm') || u.endsWith('.ogg');
    }

    isAudioFile(url: string): boolean {
      if (!url) return false;
      const u = url.toLowerCase();
      return u.endsWith('.mp3') || u.endsWith('.wav') || u.endsWith('.ogg');
    }

    isImageFile(url: string): boolean {
      if (!url) return false;
      return /\.(jpeg|jpg|png|gif|bmp|webp)$/.test(url.toLowerCase());
    }
  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();
  
  posts: Post[] = [];
  typesPosts: TypePost[] = [];
  isLoading = false;
  errorMessage = '';
  isAuthenticated = false;
  currentUserRole: string | null = null;
  
  selectedTypeId: number | null = null;
  searchTerm = '';
  selectedTagName: string | null = null;
  
  cursor: number | null = null;
  limit = 10;
  hasMore = true;

  showImageModal = false;
  currentGalleryFiles: { url: string, type: 'image' | 'video' | 'audio' | 'pdf' | 'doc' }[] = [];
  currentGalleryIndex = 0;

  showDropdownId: number | null = null;
  currentUserId: number | null = null;
  openComments = new Set<number>();
  commentRefreshTrigger: Record<number, number> = {};
  reportedPostIds = new Set<number>();

  showLikesModal = false;
  usersWhoLiked: PostLiked[] = [];
  loadingLikes = false;

  showReportModal = false;
  showReportConfirmModal = false;
  showReportSuccessModal = false;
  selectedPostForReport: Post | null = null;
  reportReason = '';
  reportExtraComments = '';
  reportError = '';
  isReporting = false;
  reportReasonOptions = [
    { value: 'inappropriate', label: 'Contenido inapropiado' },
    { value: 'spam', label: 'Spam o publicidad' },
    { value: 'fraud', label: 'Estafa o fraude' },
    { value: 'harassment', label: 'Acoso o discurso de odio' },
    { value: 'fake', label: 'Información falsa' },
    { value: 'other', label: 'Otro' }
  ];

  // Cache de permisos
  private _canLike: boolean | null = null;
  private _canRequestDonation: boolean | null = null;
  private _canCreatePost: boolean | null = null;
  private _permissionsCacheTime: number = 0;
  private readonly PERMISSIONS_CACHE_TTL = 5000; // 5 segundos

  constructor(
    private postsService: PostsService,
    private router: Router,
    private authService: AuthService,
    private route: ActivatedRoute,
    private viewportScroller: ViewportScroller,
    private alertService: AlertService,
    private reportService: ReportService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    // Paralelizar carga inicial de tipos y usuario
    forkJoin({
      types: this.postsService.getAllTypePost(),
      user: this.authService.currentUser$.pipe(take(1))
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ types }) => {
          this.typesPosts = types;
        },
        error: (err) => {
          console.error('Error loading initial data:', err);
          // Cargar tipos por separado si falla
          this.loadTypePosts();
        }
      });
    
    this.route.queryParams
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        this.selectedTagName = params['tag'] || null;
        if (this.selectedTagName) {
          this.filterPosts();
        } else {
          this.loadPosts();
        }
      });
    
    this.isAuthenticated = this.authService.isAuthenticated();
    
    const currentUser = this.authService.currentUserValue;
    this.currentUserId = currentUser?.id ? Number(currentUser.id) : null;
    this.currentUserRole = currentUser?.role || null;
    
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe((user) => {
        this.isAuthenticated = this.authService.isAuthenticated();
        this.currentUserId = user?.id ? Number(user.id) : null;
        this.currentUserRole = user?.role || null;
        // Invalidar cache de permisos cuando cambia el usuario
        this._canLike = null;
        this._canRequestDonation = null;
        this._canCreatePost = null;
      });

    // Debounce para búsqueda
    this.searchSubject$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(searchTerm => {
        this.searchTerm = searchTerm;
        if (searchTerm.length >= 3) {
          this.filterPosts();
        } else if (searchTerm.length === 0 && !this.selectedTypeId) {
          this.loadPosts();
        } else if (searchTerm.length === 0 && this.selectedTypeId) {
          this.filterPosts();
        }
      });
  }

  ngOnDestroy(): void {
    this.searchSubject$.complete();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // TrackBy functions para optimizar *ngFor
  trackByPostId(index: number, post: Post): number {
    return post.id;
  }

  trackByFileIndex(index: number, file: any): string | number {
    // Usar la URL o el ID del archivo como identificador único
    return file?.id || file?.image || index;
  }

  trackByTagId(index: number, postTag: any): string {
    return postTag?.tag?.id || index;
  }

  trackByArticleId(index: number, article: any): number {
    return article?.article?.id || index;
  }

  trackByTypeId(index: number, type: TypePost): number {
    return type.id;
  }

  // Métodos helper optimizados usando datos precalculados
  getFileType(file: any, index: number): string {
    if ((file as any)._cachedType) {
      return (file as any)._cachedType;
    }
    const url = file.image || '';
    let type = 'doc';
    if (this.isImageFile(url)) type = 'image';
    else if (this.isVideoFile(url)) type = 'video';
    else if (this.isAudioFile(url)) type = 'audio';
    else if (this.isPdfFile(url)) type = 'pdf';
    (file as any)._cachedType = type;
    return type;
  }

  isImageFileCached(post: Post, index: number): boolean {
    const fileTypes = (post as any)._fileTypes;
    return fileTypes && fileTypes[index] === 'image';
  }

  isVideoFileCached(post: Post, index: number): boolean {
    const fileTypes = (post as any)._fileTypes;
    return fileTypes && fileTypes[index] === 'video';
  }

  isAudioFileCached(post: Post, index: number): boolean {
    const fileTypes = (post as any)._fileTypes;
    return fileTypes && fileTypes[index] === 'audio';
  }

  isPdfFileCached(post: Post, index: number): boolean {
    const fileTypes = (post as any)._fileTypes;
    return fileTypes && fileTypes[index] === 'pdf';
  }

  isDocFileCached(post: Post, index: number): boolean {
    const fileTypes = (post as any)._fileTypes;
    return fileTypes && fileTypes[index] === 'doc';
  }

  loadTypePosts(): void {
    this.postsService.getAllTypePost()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (types) => {
          this.typesPosts = types;
        },
        error: (err) => {
          console.error('Error loading post types:', err);
        }
      });
  }

  loadPosts(append = false): void {
    this.isLoading = true;
    this.errorMessage = '';

    const params = {
      limit: this.limit,
      cursor: append && this.cursor ? this.cursor : undefined
    };

    this.postsService.getAllPosts(params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (posts) => {
          // Defensa: asegurarse de que el backend devolvió un array.
          const normalizedPosts = Array.isArray(posts)
            ? posts
            : (posts && Array.isArray((posts as any).data) ? (posts as any).data : []);

          // Precalcular tipos de archivo para optimización
          this.precalculateFileTypes(normalizedPosts);

          if (append) {
            this.posts = [...this.posts, ...normalizedPosts];
          } else {
            this.posts = normalizedPosts;
          }
          
          this.hasMore = posts.length === this.limit;
          if (posts.length > 0) {
            this.cursor = posts[posts.length - 1].id;
          }
          
          this.isLoading = false;
          this.restoreScrollPosition();
        },
        error: (err) => {
          console.error('Error loading posts:', err);
          this.errorMessage = 'Error al cargar las publicaciones';
          this.isLoading = false;
        }
      });
  }

  // Precalcular tipos de archivo para evitar llamadas repetidas en el template
  private precalculateFileTypes(posts: Post[]): void {
    posts.forEach(post => {
      if (post.imagePost && Array.isArray(post.imagePost)) {
        (post as any)._fileTypes = post.imagePost.map((file: any) => {
          const url = file.image || '';
          if (this.isImageFile(url)) return 'image';
          if (this.isVideoFile(url)) return 'video';
          if (this.isAudioFile(url)) return 'audio';
          if (this.isPdfFile(url)) return 'pdf';
          return 'doc';
        });
      }
    });
  }

  restoreScrollPosition(): void {
    const savedPosition = sessionStorage.getItem('postListScrollPosition');
    if (savedPosition) {
      setTimeout(() => {
        requestAnimationFrame(() => {
          window.scrollTo({
            top: parseInt(savedPosition, 10),
            behavior: 'auto'
          });
          sessionStorage.removeItem('postListScrollPosition');
        });
      }, 300);
    }
  }

  filterPosts(): void {
    if (!this.searchTerm && !this.selectedTypeId && !this.selectedTagName) {
      this.loadPosts();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.cursor = null;
    this.hasMore = false;

    const filters: FilterPostDTO = {};
    
    if (this.searchTerm && this.searchTerm.trim()) {
      filters.search = this.searchTerm.trim();
    }
    
    if (this.selectedTypeId) {
      filters.typePost = this.selectedTypeId;
    }

    if (this.selectedTagName) {
      filters.tags = [this.selectedTagName];
    }
    
    filters.orderBy = 'createdAt';
    filters.orderDirection = 'DESC';

    this.postsService.getPostsWithFilters(filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (posts) => {
          // Precalcular tipos de archivo
          this.precalculateFileTypes(posts);
          this.posts = posts;
          this.isLoading = false;
        },
        error: (err) => {
          // Si es 404, significa que no hay resultados con ese filtro
          if (err.status === 404) {
            this.posts = [];
            this.errorMessage = '';
          } else {
            this.errorMessage = 'Error al filtrar las publicaciones';
          }
          this.isLoading = false;
          console.error('Error filtering posts:', err);
        }
      });
  }

  onTypeFilterChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    this.selectedTypeId = value === '' ? null : +value;
    
    if (this.selectedTypeId === null && !this.searchTerm) {
      this.loadPosts();
    } else {
      this.filterPosts();
    }
  }

  onSearchChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.trim();
    // Usar Subject con debounce en lugar de filtrar inmediatamente
    this.searchSubject$.next(value);
  }

  loadMore(): void {
    if (!this.isLoading && this.hasMore) {
      this.loadPosts(true);
    }
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedTypeId = null;
    this.selectedTagName = null;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {}
    });
    this.loadPosts();
  }

  filterByTag(tagName: string): void {
    this.selectedTagName = tagName;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tag: tagName }
    });
    this.filterPosts();
  }

  goToCreate(): void {
    this.router.navigate(['/post/create']);
  }

  viewPostDetails(postId: number): void {
    sessionStorage.setItem('postListScrollPosition', window.pageYOffset.toString());
    this.router.navigate(['/post', postId]);
  }

  goToEdit(postId: number): void {
    this.router.navigate(['/post/edit', postId]);
  }

  viewImage(imageUrl: string): void {
    window.open(imageUrl, '_blank');
  }

  toggleDropdown(postId: number, event: Event): void {
    event.stopPropagation();
    this.showDropdownId = this.showDropdownId === postId ? null : postId;
  }

  closeDropdown(): void {
    this.showDropdownId = null;
  }

  isPostOwner(post: Post): boolean {
    if (!post || !this.currentUserId) return false;
    return post.user.id === this.currentUserId;
  }

  editPost(post: Post): void {
    this.closeDropdown();
    this.router.navigate(['/post/edit', post.id]);
  }

  async deletePost(post: Post): Promise<void> {
    this.closeDropdown();
    
    const confirmed = await this.alertService.confirm({
      title: '¿Eliminar publicación?',
      message: `¿Estás seguro de que deseas eliminar <strong>"${post.title}"</strong>?<br><br>Esta acción no se puede deshacer.`,
      type: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280'
    });

    if (confirmed) {
      this.alertService.showLoading('Eliminando...', 'Por favor espera');

      this.postsService.deletePost(post.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.posts = this.posts.filter(p => p.id !== post.id);
            this.alertService.close();
            
            // Esperar un momento antes de mostrar el mensaje de éxito
            setTimeout(async () => {
              await this.alertService.success(
                '¡Eliminado!',
                'La publicación ha sido eliminada exitosamente.'
              );
            }, 300);
          },
          error: (err) => {
            console.error('Error al eliminar el post:', err);
            this.alertService.close();
            
            // Esperar un momento antes de mostrar el mensaje de error
            setTimeout(async () => {
              await this.alertService.error(
                'Error',
                'Hubo un error al eliminar la publicación. Por favor, intenta nuevamente.'
              );
            }, 300);
          }
        });
    }
  }

  // Getters con caché para evitar llamadas repetidas
  get canLike(): boolean {
    const now = Date.now();
    if (this._canLike === null || (now - this._permissionsCacheTime) > this.PERMISSIONS_CACHE_TTL) {
      this._canLike = this.authService.canLike();
      this._permissionsCacheTime = now;
    }
    return this._canLike;
  }

  get canRequestDonation(): boolean {
    const now = Date.now();
    if (this._canRequestDonation === null || (now - this._permissionsCacheTime) > this.PERMISSIONS_CACHE_TTL) {
      this._canRequestDonation = this.authService.canRequestDonation();
      this._permissionsCacheTime = now;
    }
    return this._canRequestDonation;
  }

  get canCreatePost(): boolean {
    const now = Date.now();
    if (this._canCreatePost === null || (now - this._permissionsCacheTime) > this.PERMISSIONS_CACHE_TTL) {
      this._canCreatePost = this.authService.canCreatePost();
      this._permissionsCacheTime = now;
    }
    return this._canCreatePost;
  }

  toggleLike(post: Post): void {
    if (!this.authService.canLike()) {
      this.router.navigate(['/auth/login']);
      return;
    }
    if (post.userHasLiked) {
      this.postsService.removeLikeFromPost(post.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            post.userHasLiked = false;
            post.likesCount--;
          },
          error: (err) => console.error('Error removing like:', err)
        });
    } else {
      this.postsService.addLikeToPost(post.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            post.userHasLiked = true;
            post.likesCount++;
          },
          error: (err) => console.error('Error adding like:', err)
        });
    }
  }

  canReport(post: Post): boolean {
    if (!post || !this.isAuthenticated) return false;
    const role = (this.currentUserRole || '').toLowerCase();
    const isDonor = role === 'donor' || role === 'donante' || role === 'user';
    return isDonor && !this.isPostOwner(post) && !this.isPostReported(post);
  }

  isPostReported(post: Post): boolean {
    return this.reportedPostIds.has(post.id) || Boolean((post as any)?.isReported);
  }

  openReportModal(post: Post): void {
    if (!this.isAuthenticated) {
      this.router.navigate(['/auth/login']);
      return;
    }

    if (!this.canReport(post)) {
      this.toastService.warning('No permitido', 'Solo los donantes pueden reportar publicaciones de otras organizaciones.');
      return;
    }

    this.selectedPostForReport = post;
    this.reportReason = '';
    this.reportExtraComments = '';
    this.reportError = '';
    this.showReportModal = true;
    this.showReportConfirmModal = false;
  }

  closeReportModal(): void {
    this.showReportModal = false;
    this.showReportConfirmModal = false;
    this.reportReason = '';
    this.reportExtraComments = '';
    this.reportError = '';
    this.selectedPostForReport = null;
  }

  submitReport(): void {
    if (!this.selectedPostForReport) {
      this.reportError = 'No se encontró la publicación seleccionada';
      return;
    }

    if (!this.reportReason.trim()) {
      this.reportError = 'Selecciona un motivo para el reporte';
      return;
    }

    this.reportError = '';
    this.showReportConfirmModal = true;
  }

  cancelReportConfirmation(): void {
    this.showReportConfirmModal = false;
  }

  confirmReport(): void {
    if (!this.selectedPostForReport || !this.reportReason.trim()) {
      return;
    }

    this.isReporting = true;

    const payload = {
      report: this.reportReason,
      extraComments: this.reportExtraComments?.trim() || undefined,
      postReport: this.buildPostReportSummary(this.selectedPostForReport),
      postId: this.selectedPostForReport.id,
      idUser: this.currentUserId || undefined
    };

    this.reportService.createReport(payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          if (this.selectedPostForReport) {
            this.reportedPostIds.add(this.selectedPostForReport.id);
          }

          this.toastService.success('Reporte enviado', 'Gracias por ayudarnos a mantener la comunidad segura.');
          this.isReporting = false;
          this.showReportConfirmModal = false;
          this.showReportModal = false;
          this.showReportSuccessModal = true;
          this.selectedPostForReport = null;
          this.reportReason = '';
          this.reportExtraComments = '';
        },
        error: (err) => {
          const message = err?.error?.message || 'No se pudo enviar el reporte. Intenta nuevamente';
          this.toastService.error('Error al reportar', message);
          this.isReporting = false;
          this.showReportConfirmModal = false;
        }
      });
  }

  closeReportSuccessModal(): void {
    this.showReportSuccessModal = false;
  }

  private buildPostReportSummary(post: Post): string {
    const author = post?.user?.username || 'Usuario desconocido';
    return `POST #${post.id} - "${post.title}" de ${author}`;
  }

  handleCreatePost(): void {
    if (!this.authService.canCreatePost()) {
      if (!this.authService.isAuthenticated()) {
        this.router.navigate(['/auth/login']);
      } else {
        this.alertService.showAlert('Debes verificar tu cuenta para crear publicaciones', 'warning');
      }
      return;
    }
    this.router.navigate(['/post/create']);
  }

  requestDonation(post: Post): void {
    if (!this.authService.canRequestDonation()) {
      if (!this.authService.isAuthenticated()) {
        this.router.navigate(['/auth/login']);
      } else {
        this.alertService.showAlert('Debes verificar tu cuenta para solicitar donaciones', 'warning');
      }
      return;
    }
    this.router.navigate(['/organization/donations/create'], {
      queryParams: { post: post.id }
    });
  }

  donateToCampaign(post: Post): void {
    // Navegar a la página de donación con el ID del post
    this.router.navigate(['/organization/donations/create'], {
      queryParams: { post: post.id }
    });
  }

  openGallery(files: any[], index: number): void {
    // files: post.imagePost
    this.currentGalleryFiles = files.map(f => {
      const url = f.image;
      if (this.isImageFile(url)) return { url, type: 'image' };
      if (this.isVideoFile(url)) return { url, type: 'video' };
      if (this.isAudioFile(url)) return { url, type: 'audio' };
      if (this.isPdfFile(url)) return { url, type: 'pdf' };
      return { url, type: 'doc' };
    });
    this.currentGalleryIndex = index;
    this.showImageModal = true;
    document.body.style.overflow = 'hidden';
  }

  closeImageGallery(): void {
    this.showImageModal = false;
    document.body.style.overflow = 'auto';
  }

  nextGalleryFile(): void {
    if (this.currentGalleryIndex < this.currentGalleryFiles.length - 1) {
      this.currentGalleryIndex++;
    }
  }

  previousGalleryFile(): void {
    if (this.currentGalleryIndex > 0) {
      this.currentGalleryIndex--;
    }
  }

  toggleComments(postId: number): void {
    if (this.openComments.has(postId)) {
      this.openComments.delete(postId);
    } else {
      this.openComments.add(postId);
    }
  }

  isCommentsOpen(postId: number): boolean {
    return this.openComments.has(postId);
  }

  getCommentRefreshTrigger(postId: number): number {
    return this.commentRefreshTrigger[postId] || 0;
  }

  handleCommentCreated(postId: number): void {
    this.commentRefreshTrigger[postId] = (this.commentRefreshTrigger[postId] || 0) + 1;
  }

  handleCommentDeleted(postId: number): void {
    this.commentRefreshTrigger[postId] = (this.commentRefreshTrigger[postId] || 0) + 1;
  }

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (!this.showImageModal) return;
    if (event.key === 'ArrowRight') {
      this.nextGalleryFile();
    } else if (event.key === 'ArrowLeft') {
      this.previousGalleryFile();
    } else if (event.key === 'Escape') {
      this.closeImageGallery();
    }
  }

  @HostListener('document:click', ['$event'])
  handleClickOutside(event: Event): void {
    const target = event.target as HTMLElement;
    if (this.showDropdownId && !target.closest('.dropdown-container')) {
      this.closeDropdown();
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    this.onKeyDown(event);
  }

  showUsersWhoLiked(postId: number): void {
    this.loadingLikes = true;
    this.showLikesModal = true;
    this.usersWhoLiked = [];

    this.postsService.getUsersLikePost(postId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (users) => {
          this.usersWhoLiked = users;
          this.loadingLikes = false;
        },
        error: (err) => {
          console.error('Error loading users who liked:', err);
          this.loadingLikes = false;
          this.usersWhoLiked = [];
        }
      });
  }

  closeLikesModal(): void {
    this.showLikesModal = false;
    this.usersWhoLiked = [];
  }

  getTypeColor(typeName: string): string {
    const typeColors: { [key: string]: string } = {
      'donacion': 'bg-blue-100 text-blue-800',
      'publicacion': 'bg-purple-100 text-purple-800',
      'donacion completada': 'bg-green-100 text-green-800',
      'solicitud de donacion': 'bg-orange-100 text-orange-800',
      'articulos para donar': 'bg-pink-100 text-pink-800'
    };
    return typeColors[typeName] || 'bg-gray-100 text-gray-800';
  }

  navigateToProfile(userId: number, event: Event): void {
    event.stopPropagation(); // Prevenir que se abra el detalle del post
    this.router.navigate(['/profile', userId]);
  }
}

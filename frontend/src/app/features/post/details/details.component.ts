import { Component, OnInit, OnDestroy, HostListener, Pipe, PipeTransform } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { PostsService, Post, PostLiked } from '../../../core/services/posts.service';
import { AuthService } from '../../../core/services/auth.service';
import { SidebarComponent } from '../../../shared/components/sidebar/sidebar.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { AlertService } from '../../../shared/services/alert.service';

@Pipe({ name: 'safeUrl' })
export class SafeUrlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}
  transform(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
}

@Component({
  selector: 'app-details',
  standalone: true,
  imports: [CommonModule, RouterModule, SidebarComponent, ButtonComponent, SafeUrlPipe],
  templateUrl: './details.component.html',
  styleUrl: './details.component.scss'
})
export class DetailsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
  post: Post | null = null;
  isLoading = true;
  errorMessage = '';
  isAuthenticated = false;
  postId!: number;
  currentUserId: number | null = null;

  // Image gallery modal
  showImageModal = false;
  currentGalleryFiles: { url: string, type: 'image' | 'video' | 'audio' | 'pdf' | 'doc' }[] = [];
  currentGalleryIndex = 0;
  // Mantener compatibilidad con código existente
  currentImages: string[] = [];
  currentImageIndex = 0;

  // Dropdown menu
  showDropdown = false;

  // Likes modal
  showLikesModal = false;
  usersWhoLiked: PostLiked[] = [];
  loadingLikes = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private postsService: PostsService,
    private authService: AuthService,
    private alertService: AlertService,
    private location: Location
  ) {}

  ngOnInit(): void {
    // Get post ID from route
    this.route.params
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        this.postId = +params['id'];
        if (this.postId) {
          this.loadPost();
        }
      });

    // Check authentication
    this.isAuthenticated = this.authService.isAuthenticated();
    const currentUser = this.authService.currentUserValue;
    this.currentUserId = currentUser?.id ? Number(currentUser.id) : null;
    
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.isAuthenticated = this.authService.isAuthenticated();
        this.currentUserId = user?.id ? Number(user.id) : null;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    document.body.style.overflow = 'auto';
  }

  loadPost(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.postsService.getPostById(this.postId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (post) => {
          this.post = post;
          this.isLoading = false;
        },
        error: (err) => {
          console.error('Error loading post:', err);
          if (err.status === 404) {
            this.errorMessage = 'Publicación no encontrada';
          } else {
            this.errorMessage = 'Error al cargar la publicación';
          }
          this.isLoading = false;
        }
      });
  }

  get canLike(): boolean {
    return this.authService.canLike();
  }

  get canRequestDonation(): boolean {
    return this.authService.canRequestDonation();
  }

  get canCreatePost(): boolean {
    return this.authService.canCreatePost();
  }

  toggleLike(): void {
    if (!this.post) return;

    if (!this.authService.canLike()) {
      this.router.navigate(['/auth/login']);
      return;
    }

    if (this.post.userHasLiked) {
      this.postsService.removeLikeFromPost(this.post.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            if (this.post) {
              this.post.userHasLiked = false;
              this.post.likesCount--;
            }
          },
          error: (err) => console.error('Error removing like:', err)
        });
    } else {
      this.postsService.addLikeToPost(this.post.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            if (this.post) {
              this.post.userHasLiked = true;
              this.post.likesCount++;
            }
          },
          error: (err) => console.error('Error adding like:', err)
        });
    }
  }

  requestDonation(): void {
    if (!this.post) return;

    if (!this.authService.canRequestDonation()) {
      if (!this.authService.isAuthenticated()) {
        this.router.navigate(['/auth/login']);
      } else {
        this.alertService.showAlert('Debes verificar tu cuenta para solicitar donaciones', 'warning');
      }
      return;
    }

    this.router.navigate(['/organization/donations/create'], {
      queryParams: { post: this.post.id }
    });
  }

  donateToCampaign(): void {
    if (!this.post) return;
    this.router.navigate(['/donor/donate'], {
      queryParams: { campaign: this.post.id }
    });
  }

  toggleDropdown(): void {
    this.showDropdown = !this.showDropdown;
  }

  closeDropdown(): void {
    this.showDropdown = false;
  }

  isPostOwner(): boolean {
    if (!this.post || !this.currentUserId) return false;
    return this.post.user.id === this.currentUserId;
  }

  editPost(): void {
    if (!this.post) return;
    this.closeDropdown();
    this.router.navigate(['/post/edit', this.post.id]);
  }

  async deletePost(): Promise<void> {
    if (!this.post) return;
    this.closeDropdown();
    
    const confirmed = await this.alertService.confirm({
      title: '¿Eliminar publicación?',
      message: `¿Estás seguro de que deseas eliminar <strong>"${this.post.title}"</strong>?<br><br>Esta acción no se puede deshacer.`,
      type: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280'
    });

    if (confirmed && this.post) {
      this.alertService.showLoading('Eliminando...', 'Por favor espera');

      this.postsService.deletePost(this.post.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: async () => {
            this.alertService.close();
            
            // Esperar un momento antes de mostrar el éxito y redirigir
            setTimeout(async () => {
              await this.alertService.success(
                '¡Eliminado!',
                'La publicación ha sido eliminada exitosamente.'
              );
              this.router.navigate(['/post']);
            }, 300);
          },
          error: (err) => {
            console.error('Error al eliminar el post:', err);
            this.alertService.close();
            
            // Esperar un momento antes de mostrar el error
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

  goBack(): void {
    this.location.back();
  }

  // Helpers para tipo de archivo (igual que en list.component.ts)
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

  // Image Gallery Methods
  openGallery(files: any[], index: number): void {
    // files: post.imagePost
    this.currentGalleryFiles = files.map(f => {
      const url = f.image;
      if (this.isImageFile(url)) return { url, type: 'image' as const };
      if (this.isVideoFile(url)) return { url, type: 'video' as const };
      if (this.isAudioFile(url)) return { url, type: 'audio' as const };
      if (this.isPdfFile(url)) return { url, type: 'pdf' as const };
      return { url, type: 'doc' as const };
    });
    this.currentGalleryIndex = index;
    // Mantener compatibilidad
    this.currentImages = files.map(f => f.image);
    this.currentImageIndex = index;
    this.showImageModal = true;
    document.body.style.overflow = 'hidden';
  }

  openImageGallery(images: any[], index: number): void {
    this.openGallery(images, index);
  }

  closeImageGallery(): void {
    this.showImageModal = false;
    document.body.style.overflow = 'auto';
  }

  nextGalleryFile(): void {
    if (this.currentGalleryIndex < this.currentGalleryFiles.length - 1) {
      this.currentGalleryIndex++;
      this.currentImageIndex = this.currentGalleryIndex;
    }
  }

  previousGalleryFile(): void {
    if (this.currentGalleryIndex > 0) {
      this.currentGalleryIndex--;
      this.currentImageIndex = this.currentGalleryIndex;
    }
  }

  nextImage(): void {
    this.nextGalleryFile();
  }

  previousImage(): void {
    this.previousGalleryFile();
  }

  @HostListener('document:click', ['$event'])
  handleClickOutside(event: Event): void {
    const target = event.target as HTMLElement;
    if (this.showDropdown && !target.closest('.dropdown-container')) {
      this.closeDropdown();
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    if (!this.showImageModal) return;
    
    if (event.key === 'ArrowRight') {
      this.nextImage();
    } else if (event.key === 'ArrowLeft') {
      this.previousImage();
    } else if (event.key === 'Escape') {
      this.closeImageGallery();
    }
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

  getAvatarUrl(username: string, profilePhoto?: string): string {
    if (profilePhoto) {
      return profilePhoto;
    }
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random`;
  }

  onImageError(event: Event, username: string): void {
    const img = event.target as HTMLImageElement;
    if (img) {
      img.src = this.getAvatarUrl(username);
    }
  }
}
